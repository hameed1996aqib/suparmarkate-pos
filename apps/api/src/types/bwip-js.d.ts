declare module "bwip-js" {
  const bwipjs: {
    toBuffer(options: Record<string, unknown>): Promise<Buffer>;
    toSVG(options: Record<string, unknown>): string;
  };

  export default bwipjs;
}