import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';

import FilterOptions from '../FilterOptions';

function Harness() {
  const [open, setOpen] = useState<string | null>(null);
  const [sources, setSources] = useState(['來源甲']);
  const [titles, setTitles] = useState(['作品甲']);
  const [years, setYears] = useState(['2026']);
  return (
    <FilterOptions
      openFilter={open}
      setOpenFilter={setOpen}
      sourceOptions={['來源甲', '來源乙']}
      filterSources={sources}
      setFilterSources={setSources}
      titleOptions={['作品甲']}
      selectedTitles={titles}
      setSelectedTitles={setTitles}
      yearOptions={['2026']}
      selectedYears={years}
      setSelectedYears={setYears}
      sortField='year'
      sortOrder='asc'
      onSortFieldChange={jest.fn()}
      onSortOrderChange={jest.fn()}
      sortOptions={[{ value: 'year', label: '年份排序' }]}
      onClearFilters={() => {
        setSources([]);
        setTitles([]);
        setYears([]);
      }}
    />
  );
}

it('removes individual filters through existing callbacks and counts remaining filters', () => {
  render(<Harness />);
  expect(screen.getByRole('button', { name: '篩選 (3)' })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  fireEvent.click(screen.getByRole('button', { name: '移除來源篩選：來源甲' }));
  expect(
    screen.queryByRole('button', { name: '移除來源篩選：來源甲' })
  ).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: '篩選 (2)' })).toBeInTheDocument();
  expect(
    screen.getByRole('button', { name: '移除標題篩選：作品甲' })
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '清空篩選' }));
  expect(screen.getByRole('button', { name: '清空篩選' })).toBeDisabled();
});

it('labels disclosure and exposes selection state without submitting a parent form', () => {
  const submit = jest.fn((event) => event.preventDefault());
  render(
    <form onSubmit={submit}>
      <Harness />
    </form>
  );
  const toggle = screen.getByRole('button', { name: '展開篩選條件' });
  expect(toggle).toHaveAttribute('aria-expanded', 'false');
  fireEvent.click(toggle);
  expect(screen.getByRole('button', { name: '收合篩選條件' })).toHaveAttribute(
    'aria-expanded',
    'true'
  );
  fireEvent.click(screen.getByRole('button', { name: '來源' }));
  expect(screen.getByRole('button', { name: '來源甲' })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  fireEvent.click(screen.getByRole('button', { name: '來源乙' }));
  expect(screen.getByRole('button', { name: '來源乙' })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  fireEvent.click(screen.getByRole('button', { name: '排序' }));
  expect(screen.getByRole('button', { name: '排序' })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  expect(screen.getByRole('button', { name: '年份排序' })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  expect(submit).not.toHaveBeenCalled();
});
