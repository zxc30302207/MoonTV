/**
 * PageLayout 組件 - 簡化版
 * 導航欄已提升到根佈局（layout.tsx），此組件僅用於內容容器
 * 保留此組件是為了向後兼容，避免大量頁面修改
 */

interface PageLayoutProps {
  children: React.ReactNode;
  activePath?: string; // 保留但已不使用，activePath 由導航欄組件自動檢測
}

const PageLayout = ({ children }: PageLayoutProps) => {
  return (
    <>
      {children}
    </>
  );
};

export default PageLayout;
