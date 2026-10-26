import { NextRequest, NextResponse } from 'next/server';

import { getVerifiedAuthInfo } from '@/lib/auth-server';
import { inflateBackup } from '@/lib/backup-compression';
import { backupToRows } from '@/lib/backup-kv';
import { configSelfCheck, setCachedConfig } from '@/lib/config';
import { markConfigSnapshot } from '@/lib/config-snapshot';
import { SimpleCrypto } from '@/lib/crypto';
import { getStorage } from '@/lib/db';

import { validateBackup } from '../validation';

export const runtime = 'nodejs';

function encodeSSE(data: unknown): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

export async function POST(req: NextRequest) {
  // 检查存储类型
  const storageType = process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage';
  if (storageType === 'localstorage') {
    return NextResponse.json(
      { error: '不支持本地存储进行数据迁移' },
      { status: 400 }
    );
  }

  // 验证身份和权限
  const authInfo = await getVerifiedAuthInfo(req);
  if (!authInfo || !authInfo.username) {
    return NextResponse.json({ error: '未登录' }, { status: 401 });
  }

  // 检查用户权限（只有站长可以导入数据）
  if (authInfo.username !== process.env.USERNAME) {
    return NextResponse.json(
      { error: '权限不足，只有站长可以导入数据' },
      { status: 401 }
    );
  }

  // 解析表单数据
  const formData = await req.formData();
  const file = formData.get('file') as File;
  const password = formData.get('password') as string;

  if (!file || typeof file === 'string' || file.size > 64 * 1024 * 1024) {
    return NextResponse.json({ error: '请选择备份文件' }, { status: 400 });
  }

  if (!password || typeof password !== 'string') {
    return NextResponse.json({ error: '请提供解密密码' }, { status: 400 });
  }

  // 读取文件内容
  const encryptedData = await file.text();

  // 解密数据
  let decryptedData: string;
  try {
    decryptedData = SimpleCrypto.decrypt(encryptedData, password);
  } catch (error) {
    return NextResponse.json(
      { error: '解密失败，请检查密码是否正确' },
      { status: 400 }
    );
  }

  // Validate the entire backup before deleting any existing data.
  let importData: NonNullable<ReturnType<typeof validateBackup>>;
  try {
    const compressedBuffer = Buffer.from(decryptedData, 'base64');
    const decompressedData = inflateBackup(compressedBuffer);
    const validated = validateBackup(JSON.parse(decompressedData));
    if (!validated) throw new Error('Invalid backup');
    importData = validated;
    importData.data.adminConfig = configSelfCheck(importData.data.adminConfig);
  } catch {
    return NextResponse.json({ error: '備份文件格式無效' }, { status: 400 });
  }

  // Materialize/validate every row before invoking the single DB transaction.
  let rows: Awaited<ReturnType<typeof backupToRows>>;
  try {
    rows = await backupToRows({
      ...importData.data,
      extraRows: importData.data.extraRows || [],
    });
  } catch {
    return NextResponse.json(
      { error: '備份資料鍵或憑證格式無效' },
      { status: 400 }
    );
  }
  const TOTAL_USERS = Object.keys(importData.data.userData).length;
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
        send({
          type: 'stage',
          message: '正在原子還原；完成前現有資料保持不變...',
          percent: 0,
        });
        await getStorage().restoreAllData(rows);
        markConfigSnapshot(
          importData.data.adminConfig,
          JSON.stringify(importData.data.adminConfig)
        );
        await setCachedConfig(importData.data.adminConfig);
        // 完成
        send({
          type: 'done',
          message: '数据导入成功',
          importedUsers: TOTAL_USERS,
          timestamp: importData.timestamp,
          serverVersion:
            typeof importData.serverVersion === 'string'
              ? importData.serverVersion
              : '未知版本',
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
        const errMsg = error instanceof Error ? error.message : '导入失败';
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
}
