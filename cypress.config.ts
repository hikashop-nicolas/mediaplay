import { defineConfig } from "cypress";

// End-to-end tests run against the built demo (npm run test:e2e serves demo-dist on 5173).
// These exist to check the one thing the node suite cannot: that a real browser actually
// decodes and plays what mediaplay produces.
export default defineConfig({
  e2e: {
    baseUrl: "http://localhost:5173",
    specPattern: "cypress/e2e/**/*.cy.ts",
    supportFile: false,
    video: false,
    screenshotOnRunFailure: false,
    defaultCommandTimeout: 15000,
  },
});
