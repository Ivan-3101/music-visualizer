import "./style.css";

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) {
  throw new Error("#app element not found in index.html");
}

app.innerHTML = `<h1>Music Visualizer</h1>`;
