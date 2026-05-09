import Link from 'next/link';

export const runtime = 'nodejs';

export default function NotFound() {
  return (
    <div className='flex min-h-[60vh] flex-col items-center justify-center gap-4 p-6 text-center'>
      <h1 className='text-3xl font-bold'>頁面未找到</h1>
      <p className='text-gray-500 dark:text-gray-400'>
        您訪問的頁面不存在或已被移動。
      </p>
      <Link
        href='/'
        className='rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600'
      >
        返回首頁
      </Link>
    </div>
  );
}
