import * as t from "io-ts";
import { getOrElse } from "fp-ts/Either";
import { pipe } from "fp-ts/function";

const config = t.type({
  BUCKET_NAME: t.string,
  EXTERNAL_ID: t.string,
  ROLES_TO_ASSUME: t.string,
  UPLOAD_DELAY_MS: t.number,
  REGION: t.string,
});

const parsedEnv = {
  ...process.env,
  UPLOAD_DELAY_MS: parseInt(process.env.UPLOAD_DELAY_MS, 10),
};

export type Config = t.TypeOf<typeof config>;
export default pipe(
  config.decode(parsedEnv),
  getOrElse(() => {
    throw "Configuration error";
  })
);
