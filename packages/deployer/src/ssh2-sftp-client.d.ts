/**
 * Minimal ambient declaration for `ssh2-sftp-client` (no @types package is published).
 * We only use a subset of its API; everything else is treated as `any`.
 */
declare module "ssh2-sftp-client" {
  interface ConnectOptions {
    host: string;
    port?: number;
    username: string;
    privateKey?: string | Buffer;
    passphrase?: string;
    password?: string;
  }

  interface FileInfo {
    type: "d" | "-" | "l";
    name: string;
    size: number;
    modifyTime: number;
    accessTime: number;
    rights: { user: string; group: string; other: string };
    owner: number;
    group: number;
  }

  class SftpClient {
    constructor(name?: string);
    connect(options: ConnectOptions): Promise<unknown>;
    end(): Promise<void>;
    mkdir(path: string, recursive?: boolean): Promise<string>;
    rmdir(path: string, recursive?: boolean): Promise<string>;
    delete(path: string): Promise<string>;
    list(path: string): Promise<FileInfo[]>;
    fastPut(localPath: string, remotePath: string): Promise<string>;
    put(input: Buffer | string | NodeJS.ReadableStream, remotePath: string): Promise<string>;
    /** Underlying ssh2 Client (exposed for advanced use such as `exec`). */
    client: unknown;
  }

  export default SftpClient;
}
