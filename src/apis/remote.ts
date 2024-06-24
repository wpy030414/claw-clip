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
    return (
      (await request("upload", data)) as {
        done: boolean;
      }
    ).done;
  }

  export async function download(pageSize: number, pageOffset: number) {
    return (await request("download", {
      pageSize: pageSize,
      pageOffset: pageOffset,
    })) as { total: number; blogs: Blog[] };
  }

  export async function deleteSingle(id: number) {
    return (
      (await request("delete", id)) as {
        done: boolean;
      }
    ).done;
  }
}
