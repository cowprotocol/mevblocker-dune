import app from "./app";
import log from "./log";

process.on("unhandledRejection", (e: any) => {
  try {
    log.error("unhandledRejection", e instanceof Error ? e.stack ?? e.message : e);
  } finally {
    process.exit(1);
  }
});

process.on("uncaughtException", (e: any) => {
  try {
    log.error("uncaughtException", e instanceof Error ? e.stack ?? e.message : e);
  } finally {
    process.exit(1);
  }
});

app.listen(8080);
