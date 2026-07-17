/**
 * `vite/client` types the bare asset extensions; the `?no-inline` variant (pinning small
 * files to hashed URLs instead of data: inlining) needs its own declaration.
 */
declare module "*.mp3?no-inline" {
  const src: string;
  export default src;
}
