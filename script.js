let worldGeoJSON;
let co2Data;
let years = [];
let currentYear = null;
let dataForYear = new Map();
let selectedCountry = null;
let projection;

const svg = d3.select("svg");
const g = svg.append("g");
const detailsPanel = d3.select("#details-panel");
const closeButton = d3.select("#close-details");
const countryDetails = d3.select("#country-details");

const zoom = d3.zoom()
    .scaleExtent([1, 8])
    .on("zoom", (event) => {
        g.attr("transform", event.transform);
    });

svg.call(zoom);

const tooltip = d3.select("#tooltip");

Promise.all([
    d3.json("./map/world_med.geojson"),
    d3.csv("./data/co2_emissions_filtered.csv", d3.autoType)
]).then(([geojson, csv]) => {
    worldGeoJSON = geojson;
    co2Data = csv;
    years = Array.from(new Set(co2Data.map(d => d.Year))).sort((a, b) => a - b);

    const yearSlider = d3.select("#year-slider");
    const yearLabel = d3.select("#year-label");

    yearSlider
        .attr("min", 0)
        .attr("max", years.length - 1)
        .attr("value", 0);

    yearLabel.text(years[0]);
    currentYear = years[0];
    drawMap(currentYear);

yearSlider.on("input", function() {
    currentYear = years[+this.value];
    yearLabel.text(currentYear);
    
    const currentTransform = d3.zoomTransform(svg.node());
    
    if (selectedCountry) {
        drawMap(currentYear);
        showCountryDetails(selectedCountry);
        svg.call(zoom.transform, currentTransform);
    } else {
        drawMap(currentYear);
    }
});

    closeButton.on("click", () => {
        selectedCountry = null;
        detailsPanel.classed("hidden", true);
        svg.transition()
            .duration(750)
            .call(zoom.transform, d3.zoomIdentity);
    });

    window.addEventListener("resize", () => {
        if (selectedCountry) {
            showCountryDetails(selectedCountry);
        } else {
            drawMap(currentYear);
        }
        updateLegendPosition();
    });
}).catch(err => {
    console.error("Error loading data:", err);
});

function drawMap(selectedYear) {
    const width = window.innerWidth;
    const height = window.innerHeight;
    const detailsPanelWidth = Math.min(width * 0.4, 500);
    const mapWidth = width - detailsPanelWidth;

    svg.attr("width", width).attr("height", height);

    projection = d3.geoNaturalEarth1().fitSize([mapWidth, height], worldGeoJSON);
    const path = d3.geoPath(projection);

    dataForYear.clear();
    co2Data.forEach(d => {
        if (d.Year === selectedYear && d["ISO 3166-1 alpha-3"]) {
            dataForYear.set(d["ISO 3166-1 alpha-3"], {
                Total: d.Total,
                Coal: d.Coal,
                Oil: d.Oil,
                Gas: d.Gas,
                Cement: d.Cement,
                Flaring: d.Flaring,
                Other: d.Other,
                PerCapita: d.PerCapita
            });
        }
    });

    const maxCO2 = d3.max(Array.from(dataForYear.values()), d => d.Total);
    const colorScale = d3.scaleSequential()
        .domain([1, Math.log10(maxCO2 || 10)])
        .interpolator(d3.interpolateReds)
        .unknown("#ccc");
    function getColor(val) {
        return val > 0 ? colorScale(Math.log10(val)) : "#ccc";
    }

    g.selectAll(".country").remove();

    const countries = g.selectAll(".country")
        .data(worldGeoJSON.features, d => d.properties.iso_a3);

    countries.enter()
        .append("path")
        .attr("class", "country")
        .attr("d", path)
        .attr("fill", d => getColor(dataForYear.get(d.properties.iso_a3)?.Total))
        .attr("stroke", "#666")
        .attr("stroke-width", 0.5)
        .style("cursor", "pointer") 
        .on("mousemove", (event, d) => {
            const iso3 = d.properties.iso_a3;
            const val = dataForYear.get(iso3)?.Total;
            tooltip
                .style("left", (event.pageX + 10) + "px")
                .style("top", (event.pageY - 30) + "px")
                .html(`
                    <strong>${d.properties.name}</strong><br/>
                    CO₂ Emissions: ${val != null ? val.toLocaleString() + " Mt" : "No data"}
                `)
                .classed("hidden", false);
        })
        .on("mouseout", () => {
            tooltip.classed("hidden", true);
        })
        .on("click", (event, d) => {
            const clickedCountry = d.properties.iso_a3;
            if (selectedCountry === clickedCountry) {
                resetView();
                return;
            }
            selectedCountry = d.properties.iso_a3;
            showCountryDetails(selectedCountry);
            lastZoomTransform = zoomToMainland(selectedCountry);
            g.selectAll(".country")
                .classed("selected", false);
        });

    countries.transition().duration(600)
        .attr("fill", d => getColor(dataForYear.get(d.properties.iso_a3)?.Total));

    drawLegend(maxCO2 || 10);
}

function showCountryDetails(iso3Code) {
    detailsPanel.classed("hidden", false);
    
    const countryFeature = worldGeoJSON.features.find(f => f.properties.iso_a3 === iso3Code);
    const countryName = countryFeature?.properties.name || "Unknown Country";
    const currentData = dataForYear.get(iso3Code);
    const allYearsData = co2Data.filter(d => d["ISO 3166-1 alpha-3"] === iso3Code).sort((a, b) => a.Year - b.Year);
    
    countryDetails.html("");
    
    countryDetails.append("h2").text(`${countryName} CO₂ Emissions (${currentYear})`);
    
    const topSection = countryDetails.append("div").attr("class", "top-section");
    
    const metricsContainer = topSection.append("div").attr("class", "metrics-container");
    
    if (currentData) {
        metricsContainer.append("h3").text("Current Year Breakdown");
        
        const metricsGrid = metricsContainer.append("div").attr("class", "metrics-grid");
        
        addMetric(metricsGrid, "Total", currentData.Total);
        addMetric(metricsGrid, "Per Capita", currentData.PerCapita, "t CO₂");
        
        const pieContainer = topSection.append("div").attr("class", "pie-container");
        createPieChart(pieContainer, currentData, "Emission Sources");
    }
    
    const chartsSection = countryDetails.append("div").attr("class", "charts-section")
        .style("margin-top", "10px"); 
    
    const timeSeriesContainer = chartsSection.append("div").attr("class", "chart-container");
    const timeSeriesData = allYearsData.map(d => ({
        year: d.Year,
        value: d.Total
    }));
    createTimeSeriesChart(timeSeriesContainer, timeSeriesData, "Total CO₂ Emissions Over Time (Mt)");
    
    const stackedAreaContainer = chartsSection.append("div").attr("class", "chart-container");
    createStackedAreaChart(stackedAreaContainer, allYearsData, "Emission Sources Over Time");
}

function createPieChart(container, data, title) {
    container.selectAll("*").remove();

    const containerWidth = container.node().getBoundingClientRect().width;
    const size = Math.min(containerWidth, 350);
    const radius = size / 2;
    
    const sources = ["Coal", "Oil", "Gas", "Cement", "Flaring", "Other"];
    const hasData = sources.some(source => data[source] > 0);
    if (!hasData) {
        container.append("div")
            .attr("class", "no-data-message")
            .text("No data available");
        return;
    }
    const color = d3.scaleOrdinal()
        .domain(sources)
        .range(d3.schemeTableau10);
    
    const pieData = sources.map(source => ({
        name: source,
        value: data[source] || 0
    })).filter(d => d.value > 0);
    
    const tooltip = container.append("div")
        .attr("class", "pie-tooltip");
    
    const pie = d3.pie()
        .value(d => d.value)
        .sort(null);
    
    const arc = d3.arc()
        .innerRadius(0)
        .outerRadius(radius * 0.8);
    
    const svg = container.append("svg")
        .attr("width", size)
        .attr("height", size)
        .attr("class", "pie-chart");
    
    const g = svg.append("g")
        .attr("transform", `translate(${size/2},${size/2})`);
    
    const arcs = g.selectAll(".arc")
        .data(pie(pieData))
        .enter()
        .append("g")
        .attr("class", "arc");
    
    arcs.append("path")
        .attr("d", arc)
        .attr("fill", d => color(d.data.name))
        .attr("stroke", "#fff")
        .attr("stroke-width", 1)
        .on("mouseover", function(event, d) {
            tooltip
                .style("opacity", 1)
                .html(`${d.data.name}: ${d3.format(".1f")(d.data.value)} Mt`)
                .style("left", (event.pageX - container.node().getBoundingClientRect().left + 10) + "px")
                .style("top", (event.pageY - container.node().getBoundingClientRect().top - 30) + "px");
            
            d3.select(this)
                .attr("stroke-width", 2)
                .attr("stroke", "#000");
        })
        .on("mouseout", function() {
            tooltip.style("opacity", 0);
            d3.select(this)
                .attr("stroke-width", 1)
                .attr("stroke", "#fff");
        });
    
    const legend = container.append("div")
        .attr("class", "pie-legend")
        .style("margin-top", "5px"); 
    
    pieData.forEach(d => {
        legend.append("div")
            .attr("class", "pie-legend-item")
            .html(`
                <div class="pie-legend-color" style="background-color:${color(d.name)}"></div>
                <span>${d.name}</span>
            `);
    });
}

function addMetric(container, name, value, unit = "Mt") {
    const metricDiv = container.append("div").attr("class", "metric");
    metricDiv.append("div").attr("class", "metric-name").text(name);
    metricDiv.append("div").attr("class", "metric-value")
        .text(value != null ? value.toLocaleString() + " " + unit : "No data");
}

function createTimeSeriesChart(container, data, title) {
    const width = Math.min(window.innerWidth * 0.4, 500);
    const height = 250;
    const margin = {top: 20, right: 30, bottom: 40, left: 50};
    
    container.selectAll("*").remove();
    
    const hasData = data.some(d => d.value > 0);
    if (!hasData) {
        container.append("div")
            .attr("class", "no-data-message")
            .text("No data available");
        return;
    }
    
    const svg = container.append("svg")
        .attr("class", "chart-svg")
        .attr("width", width)
        .attr("height", height)
        .attr("viewBox", `0 0 ${width} ${height}`)
        .attr("preserveAspectRatio", "xMidYMid meet");
    
    svg.append("text")
        .attr("class", "chart-title")
        .attr("x", width/2)
        .attr("y", 15)
        .text(title);
    
    const x = d3.scaleLinear()
        .domain(d3.extent(data, d => d.year))
        .range([margin.left, width - margin.right]);
    
    const y = d3.scaleLinear()
        .domain([0, d3.max(data, d => d.value)])
        .nice()
        .range([height - margin.bottom, margin.top]);
    
    const line = d3.line()
        .x(d => x(d.year))
        .y(d => y(d.value));
    
    svg.append("path")
        .datum(data)
        .attr("fill", "none")
        .attr("stroke", "steelblue")
        .attr("stroke-width", 2)
        .attr("d", line);
    
    svg.selectAll(".data-point")
        .data(data)
        .enter()
        .append("circle")
        .attr("class", "data-point")
        .attr("cx", d => x(d.year))
        .attr("cy", d => y(d.value))
        .attr("r", 3)
        .attr("fill", "steelblue");
    
    svg.append("g")
        .attr("transform", `translate(0,${height - margin.bottom})`)
        .call(d3.axisBottom(x).tickFormat(d3.format("d")))
        .selectAll("text")
        .style("text-anchor", "end")
        .attr("dx", "-.8em")
        .attr("dy", ".15em")
        .attr("transform", "rotate(-45)");
    
    svg.append("g")
        .attr("transform", `translate(${margin.left},0)`)
        .call(d3.axisLeft(y));
}

function createStackedAreaChart(container, data, title) {
    container.selectAll("*").remove();
    
    const hasData = data.some(d => d.Total > 0);
    if (!hasData) {
        container.append("div")
            .attr("class", "no-data-message")
            .text("No data available");
        return;
    }

    const containerWidth = container.node().getBoundingClientRect().width;
    const width = Math.min(containerWidth, 500);
    const height = 250;
    const margin = {top: 30, right: 100, bottom: 40, left: 50};
    
    const sources = ["Coal", "Oil", "Gas", "Cement", "Flaring", "Other"];
    const color = d3.scaleOrdinal()
        .domain(sources)
        .range(d3.schemeTableau10);
    
    const stack = d3.stack()
        .keys(sources)
        .order(d3.stackOrderNone)
        .offset(d3.stackOffsetNone);
    
    const stackedData = stack(data.map(d => {
        const result = { year: d.Year };
        sources.forEach(source => {
            result[source] = d[source] || 0;
        });
        return result;
    }));
    
    const svg = container.append("svg")
        .attr("class", "chart-svg")
        .attr("width", width)
        .attr("height", height)
        .attr("viewBox", `0 0 ${width} ${height}`)
        .attr("preserveAspectRatio", "xMidYMid meet");
    
    svg.append("text")
        .attr("class", "chart-title")
        .attr("x", width / 2)
        .attr("y", 20)
        .text(title);
    
    const x = d3.scaleLinear()
        .domain(d3.extent(data, d => d.Year))
        .range([margin.left, width - margin.right]);
    
    const y = d3.scaleLinear()
        .domain([0, d3.max(stackedData, layer => d3.max(layer, d => d[1]))])
        .nice()
        .range([height - margin.bottom, margin.top]);
    
    const area = d3.area()
        .x(d => x(d.data.year))
        .y0(d => y(d[0]))
        .y1(d => y(d[1]));
    
    svg.selectAll(".area")
        .data(stackedData)
        .enter()
        .append("path")
        .attr("class", "area")
        .attr("d", area)
        .attr("fill", d => color(d.key))
        .attr("stroke", "#fff")
        .attr("stroke-width", 0.5);
    
    svg.append("g")
        .attr("class", "x-axis")
        .attr("transform", `translate(0,${height - margin.bottom})`)
        .call(d3.axisBottom(x).tickFormat(d3.format("d")))
        .selectAll("text")
        .style("text-anchor", "end")
        .attr("dx", "-.8em")
        .attr("dy", ".15em")
        .attr("transform", "rotate(-45)");
    
    svg.append("g")
        .attr("class", "y-axis")
        .attr("transform", `translate(${margin.left},0)`)
        .call(d3.axisLeft(y));
    
    const legend = container.append("div")
        .attr("class", "area-legend");
    
    sources.forEach(source => {
        legend.append("div")
            .attr("class", "area-legend-item")
            .html(`
                <span class="area-legend-color" style="background:${color(source)}"></span>
                <span>${source}</span>
            `);
    });
}
const legendWidth = 150;
const legendHeight = 60;

const legend = svg.append("g")
    .attr("class", "legend");

const defs = svg.append("defs");

const linearGradient = defs.append("linearGradient")
    .attr("id", "legend-gradient");

linearGradient.selectAll("stop")
    .data([
        { offset: "0%", color: "#ccc" },
        { offset: "10%", color: d3.interpolateReds(0.2) },
        { offset: "50%", color: d3.interpolateReds(0.6) },
        { offset: "100%", color: d3.interpolateReds(1) }
    ])
    .enter()
    .append("stop")
    .attr("offset", d => d.offset)
    .attr("stop-color", d => d.color);

legend.append("rect")
    .attr("width", legendWidth)
    .attr("height", 15)
    .style("fill", "url(#legend-gradient)")
    .style("stroke", "#666")
    .style("stroke-width", 0.5);

legend.append("text")
    .attr("x", 0)
    .attr("y", -6)
    .attr("fill", "#000")
    .attr("font-weight", "bold")
    .text("CO₂ Emissions (log scale, Mt CO₂)");

const legendAxisGroup = legend.append("g")
    .attr("transform", `translate(0, ${15})`);

function drawLegend(maxCO2) {
    const legendScale = d3.scaleLog()
        .domain([1, maxCO2])
        .range([0, legendWidth]);

    const tickValues = [1, 10, 100, 1000, 10000].filter(v => v <= maxCO2);

    const legendAxis = d3.axisBottom(legendScale)
        .tickValues(tickValues)
        .ticks(tickValues.length)
        .tickFormat(d3.format("~s"));

    legendAxisGroup.call(legendAxis);
    legendAxisGroup.select(".domain").remove(); 
}

function updateLegendPosition() {
    legend.attr("transform", `translate(20, ${window.innerHeight - legendHeight - 20})`);
}

updateLegendPosition();
function zoomToMainland(countryCode) {
    const countryBounds = {
        "USA": [-125, 24, -66, 50],   
        "RUS": [20, 41, 180, 70],     
        "FRA": [-5, 42, 15, 52],       
        "AUS": [110, -45, 155, -10],   
        "CAN": [-140, 42, -52, 70],  
        "NLD": [3, 50, 8, 54], 
    };

    const feature = worldGeoJSON.features.find(f => f.properties.iso_a3 === countryCode);
    if (!feature) return;

    const width = window.innerWidth;
    const height = window.innerHeight;
    const detailsPanelWidth = Math.min(width * 0.4, 500);
    const mapWidth = width - detailsPanelWidth;

let transform;
    if (countryBounds[countryCode]) {
        const [minX, minY, maxX, maxY] = countryBounds[countryCode];
        const bounds = [[minX, minY], [maxX, maxY]];
        const pixelBounds = bounds.map(coord => projection(coord));
        const dx = pixelBounds[1][0] - pixelBounds[0][0];
        const dy = pixelBounds[1][1] - pixelBounds[0][1];
        const scale = 0.9 / Math.max(dx / mapWidth, dy / height);
        const x = (pixelBounds[0][0] + pixelBounds[1][0]) / 2;
        const y = (pixelBounds[0][1] + pixelBounds[1][1]) / 2;
        const translate = [mapWidth/2 - scale * x, height/2 - scale * y];
        
        transform = d3.zoomIdentity
            .translate(...translate)
            .scale(scale);
    } else {
        const path = d3.geoPath(projection);
        const bounds = path.bounds(feature);
        const dx = bounds[1][0] - bounds[0][0];
        const dy = bounds[1][1] - bounds[0][1];
        const x = (bounds[0][0] + bounds[1][0]) / 2;
        const y = (bounds[0][1] + bounds[1][1]) / 2;
        const scale = 0.9 / Math.max(dx / mapWidth, dy / height);
        const translate = [mapWidth/2 - scale * x, height/2 - scale * y];
        
        transform = d3.zoomIdentity
            .translate(...translate)
            .scale(scale);
    }

    svg.transition()
        .duration(750)
        .call(zoom.transform, transform);
        
    return transform; 
}

function resetView() {
    selectedCountry = null;
    detailsPanel.classed("hidden", true);
    g.selectAll(".country")
        .classed("selected", false);
    svg.transition()
        .duration(500)
        .call(zoom.transform, d3.zoomIdentity);
}