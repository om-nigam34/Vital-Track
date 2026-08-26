/* Thin wrappers around Chart.js (loaded via CDN in each HTML page) so the
   page scripts stay readable. Chart.js is a library, not a framework - all
   the surrounding app code is still plain HTML/CSS/JS. */

function makeSparkline(canvas, values, color) {
  return new Chart(canvas, {
    type: "line",
    data: {
      labels: values.map((_, i) => i),
      datasets: [
        {
          data: values,
          borderColor: color,
          borderWidth: 2,
          pointRadius: 0,
          tension: 0.35,
          fill: true,
          backgroundColor: (ctx) => {
            const g = ctx.chart.ctx.createLinearGradient(0, 0, 0, ctx.chart.height);
            g.addColorStop(0, color + "33");
            g.addColorStop(1, color + "00");
            return g;
          },
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: { legend: { display: false }, tooltip: { enabled: false } },
      scales: {
        x: { display: false },
        y: { display: false },
      },
      elements: { line: { borderJoinStyle: "round" } },
    },
  });
}

function updateSparkline(chart, values) {
  chart.data.labels = values.map((_, i) => i);
  chart.data.datasets[0].data = values;
  chart.update("none");
}

function makeTrendChart(canvas, labels, hr, spo2, temp) {
  const gridColor = "rgba(255,255,255,0.06)";
  const textColor = "#8b93ac";

  return new Chart(canvas, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "Heart Rate (BPM)",
          data: hr,
          borderColor: "#f0546a",
          backgroundColor: "#f0546a",
          pointRadius: 0,
          borderWidth: 2,
          tension: 0.3,
          yAxisID: "yHr",
        },
        {
          label: "SpO2 (%)",
          data: spo2,
          borderColor: "#2e9bff",
          backgroundColor: "#2e9bff",
          pointRadius: 0,
          borderWidth: 2,
          tension: 0.3,
          yAxisID: "yPct",
        },
        {
          label: "Temperature (°C)",
          data: temp,
          borderColor: "#34d399",
          backgroundColor: "#34d399",
          pointRadius: 0,
          borderWidth: 2,
          tension: 0.3,
          yAxisID: "yTemp",
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: "#12172a",
          borderColor: "#212840",
          borderWidth: 1,
          titleColor: "#edeff7",
          bodyColor: "#8b93ac",
          padding: 10,
        },
      },
      scales: {
        x: { grid: { color: gridColor }, ticks: { color: textColor, maxTicksLimit: 7 } },
        yHr: { position: "left", min: 0, max: 140, grid: { color: gridColor }, ticks: { color: textColor } },
        yPct: { display: false, min: 80, max: 100 },
        yTemp: { display: false, min: 30, max: 42 },
      },
    },
  });
}

function updateTrendChart(chart, labels, hr, spo2, temp) {
  chart.data.labels = labels;
  chart.data.datasets[0].data = hr;
  chart.data.datasets[1].data = spo2;
  chart.data.datasets[2].data = temp;
  chart.update("none");
}