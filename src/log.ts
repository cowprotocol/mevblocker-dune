import { Logger } from "tslog";
export default new Logger({
  stylePrettyLogs: false,
  prettyLogTemplate:
    "{{rawIsoStr}} {{logLevelName}} [{{filePathWithLine}}{{name}}]\t",
});
