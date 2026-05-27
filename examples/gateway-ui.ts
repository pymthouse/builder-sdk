/**
 * Example: register the lightweight gateway Web Component.
 */
import { definePmtHouseGatewayElement } from "../src/gateway/ui.js";

definePmtHouseGatewayElement();

document.addEventListener("pymthouse-job-event", (event) => {
  console.log("gateway event", (event as CustomEvent).detail);
});
