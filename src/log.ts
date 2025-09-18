import { Logger } from "tslog";

// Enhanced logger configuration with better formatting and structured logging
export default new Logger({
  stylePrettyLogs: false,
  prettyLogTemplate:
    "{{rawIsoStr}} {{logLevelName}} [{{filePathWithLine}}] {{name}}",
  minLevel: process.env.LOG_LEVEL === "debug" ? 0 : 1, // 0=debug, 1=info, 2=warn, 3=error
  name: "mevblocker-dune",
});

// Helper function for structured logging
export const createLogContext = (context: Record<string, unknown>) => {
  return {
    ...context,
    service: "mevblocker-dune",
    version: process.env.npm_package_version || "unknown",
    timestamp: new Date().toISOString(),
  };
};
