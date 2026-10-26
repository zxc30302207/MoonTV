import { NextRequest, NextResponse } from 'next/server';
import { deflate } from 'pako';

import { getVerifiedAuthInfo } from '@/lib/auth-server';
import { snapshotToBackup } from '@/lib/backup-kv';
import { SimpleCrypto } from '@/lib/crypto';
import { getStorage } from '@/lib/db';
import { normalizePasswordForStorage } from '@/lib/password';
import { CURRENT_VERSION } from '@/lib/version';

import { validateBackup } from '../validation';

export const runtime = 'nodejs';

// pako 的 gzip 是同步的，不需要 promisify

// 将对象编码为 SSE 事件文本
function encodeSSE(data: unknown): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

export async function POST(req: NextRequest) {
  try {
    // 檢查存儲類型
    const storageType = process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage';
    if (storageType === 'localstorage') {
      return NextResponse.json(
        { error: '不支持本地存儲進行數據遷移' },
        { status: 400 }
      );
    }

    // 驗證身份和權限
    const authInfo = await getVerifiedAuthInfo(req);
    if (!authInfo || !authInfo.username) {
      return NextResponse.json({ error: '未登錄' }, { status: 401 });
    }

    // 檢查用戶權限（只有站長可以導出數據）
    if (authInfo.username !== process.env.USERNAME) {
      return NextResponse.json(
        { error: '權限不足，只有站長可以導出數據' },
        { status: 401 }
      );
    }

    // 解析請求體獲取密碼
    const { password } = await req.json();
    if (!password || typeof password !== 'string') {
      return NextResponse.json({ error: '請提供加密密碼' }, { status: 400 });
    }

    // One MVCC snapshot: never combine OFFSET pages from different versions.
    const snapshot = snapshotToBackup(await getStorage().snapshotAllData());
    for (const user of Object.values(snapshot.userData)) {
      if (user.password)
        user.password = await normalizePasswordForStorage(user.password);
    }
    const owner = process.env.USERNAME;
    if (owner && process.env.PASSWORD) {
      snapshot.userData[owner] ||= {};
      snapshot.userData[owner].password = await normalizePasswordForStorage(
        process.env.PASSWORD
      );
    }
    const exportData = {
      timestamp: new Date().toISOString(),
      serverVersion: CURRENT_VERSION,
      data: snapshot,
    };
    if (!validateBackup(exportData))
      throw new Error(
        '現有資料不符合備份格式；未產生可能無法還原的備份，請先檢查舊資料'
      );
    const TOTAL_USERS = Object.keys(snapshot.userData).length;

    // 创建 SSE 流
    const encoder = new TextEncoder();
    let streamClosed = false;
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        // 推送 SSE 事件
        const send = (data: unknown) => {
          if (streamClosed) return;
          try {
            controller.enqueue(encoder.encode(encodeSSE(data)));
          } catch (err) {
            streamClosed = true; // Client disconnected; do not enqueue again.
          }
        };

        try {
          // 阶段 3：压缩并加密
          send({
            type: 'stage',
            message: '正在压缩并加密数据...',
            percent: 92,
          });

          // 将数据转换为JSON字符串
          const jsonData = JSON.stringify(exportData);

          // 先压缩数据
          const compressedData = deflate(jsonData);

          // 使用提供的密码加密压缩后的数据
          const compressedBase64 =
            Buffer.from(compressedData).toString('base64');
          const encryptedData = SimpleCrypto.encrypt(
            compressedBase64,
            password
          );

          // 生成文件名
          const now = new Date();
          const timestamp = `${now.getFullYear()}${String(
            now.getMonth() + 1
          ).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(
            now.getHours()
          ).padStart(2, '0')}${String(now.getMinutes()).padStart(
            2,
            '0'
          )}${String(now.getSeconds()).padStart(2, '0')}`;
          const filename = `moontv-backup-${timestamp}.dat`;

          // 阶段 4：分块推送加密后的文件数据（base64 字符串）
          send({ type: 'file_start', filename, percent: 95 });

          // 将加密数据分块推送，避免单条 SSE 事件过大
          const CHUNK_SIZE = 64 * 1024; // 64KB
          for (let i = 0; i < encryptedData.length; i += CHUNK_SIZE) {
            send({
              type: 'chunk',
              data: encryptedData.slice(i, i + CHUNK_SIZE),
            });
          }

          send({ type: 'file_end', percent: 100 });
          send({
            type: 'done',
            message: '数据导出成功',
            exportedUsers: TOTAL_USERS,
            filename,
            percent: 100,
          });
          if (!streamClosed) {
            streamClosed = true;
            try {
              controller.close();
            } catch {
              /* already cancelled */
            }
          }
        } catch (error) {
          const errMsg = error instanceof Error ? error.message : '导出失败';
          send({ type: 'error', message: errMsg });
          if (!streamClosed) {
            streamClosed = true;
            try {
              controller.close();
            } catch {
              /* already cancelled */
            }
          }
        }
      },
      cancel() {
        streamClosed = true;
      },
    });

    return new NextResponse(stream, {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'private, no-store, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '導出失敗' },
      { status: 500 }
    );
  }
}
