import { globalConfig } from "@/config";
import type { Blog } from "@/types/Blog";

export namespace RemoteDataSource {
  async function request(subpath: string, data: any) {
    return await (
      await fetch(`${globalConfig.dataSource.addr}/${subpath}`, {
        method: "POST",
        mode: "cors",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(data),
      })
    ).json();
  }

  export async function uploadSingle(data: Blog) {
    return (await request("upload", data)) as boolean;
  }

  export async function download(
    pageSize: number,
    pageOffset: number,
    filter: (b: Blog, _: any) => Promise<boolean>,
  ) {
    return await request("download", {
      pageSize,
      pageOffset,
    });
  }

  export async function deleteSingle(id: number) {
    return (await request("delete", id)) as boolean;
  }

  export async function isStared(id: number) {
    return (await request("is-stared", id)) as boolean;
  }

  export async function star(id: number, enable: boolean) {
    return (await request("star", { id, enable })) as boolean;
  }
}
