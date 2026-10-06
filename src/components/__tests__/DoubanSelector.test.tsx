import { fireEvent, render, screen } from '@testing-library/react';

import DoubanSelector from '../DoubanSelector';
import MultiLevelSelector from '../MultiLevelSelector';

const noop = () => undefined;

describe('Douban category selectors', () => {
  it.each([
    ['short', '熱門短劇', '高分短劇', '最新短劇'],
    ['doc', '熱門紀錄片', '高分紀錄片', '最新紀錄片'],
  ] as const)(
    'provides Traditional Chinese %s sort controls',
    (type, popular, rated, recent) => {
      const onPrimaryChange = jest.fn();
      render(
        <DoubanSelector
          type={type}
          primarySelection='熱門'
          secondarySelection='全部'
          onPrimaryChange={onPrimaryChange}
          onSecondaryChange={noop}
          onWeekdayChange={noop}
        />
      );
      expect(screen.getByText(popular)).toBeInTheDocument();
      expect(screen.getByText(recent)).toBeInTheDocument();
      fireEvent.click(screen.getByText(rated));
      expect(onPrimaryChange).toHaveBeenCalledWith('高分');
    }
  );

  it.each(['short', 'doc'] as const)(
    'keeps only meaningful %s filters',
    (contentType) => {
      render(<MultiLevelSelector contentType={contentType} onChange={noop} />);
      expect(screen.getByText('地區')).toBeInTheDocument();
      expect(screen.getByText('年代')).toBeInTheDocument();
      expect(screen.getByText('平台')).toBeInTheDocument();
      expect(screen.queryByText('類型')).not.toBeInTheDocument();
      expect(screen.queryByText('排序')).not.toBeInTheDocument();
    }
  );
});
