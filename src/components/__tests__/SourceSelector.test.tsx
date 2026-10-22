import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';

import SourceSelector from '../SourceSelector';

jest.mock('@/lib/config.client', () => ({
  getAvailableApiSitesClient: jest
    .fn()
    .mockResolvedValue([{ key: 'source1', name: '測試來源' }]),
}));
jest.mock('@/lib/utils', () => ({ getRequestTimeout: () => 30 }));
jest.mock('@/lib/sweetalert', () => ({ getSwal: jest.fn() }));

const onChange = jest.fn();
function Harness() {
  const [openFilter, setOpenFilter] = useState<string | null>(null);
  return (
    <SourceSelector
      selectedSources={[]}
      onChange={onChange}
      openFilter={openFilter}
      setOpenFilter={setOpenFilter}
    />
  );
}

it('reopens the portal settings dialog after Close and Escape without losing source choices', async () => {
  localStorage.clear();
  render(<Harness />);
  const toggle = await screen.findByTitle('搜索源設置');
  fireEvent.click(toggle);
  expect(
    screen.getByRole('dialog', { name: '搜索源設置' })
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '測試來源' }));
  expect(onChange).toHaveBeenCalledWith(['source1']);
  fireEvent.click(screen.getByRole('button', { name: '關閉' }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  fireEvent.click(toggle);
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  fireEvent.click(toggle);
  expect(screen.getByRole('dialog')).toBeInTheDocument();
});
