import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';

import { downloadM3U8Video, M3U8Task, parseM3U8 } from '@/lib/m3u8-downloader';

import DownloadManager from '../DownloadManager';

jest.mock('sweetalert2', () => ({
  __esModule: true,
  default: { fire: jest.fn() },
}));
jest.mock('../AddDownloadModal', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('../SegmentViewer', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('@/lib/download-persistence', () => ({
  restoreDownloadProgress: jest.fn(async () => 0),
  clearDownloadState: jest.fn(),
}));
jest.mock('@/lib/m3u8-downloader', () => {
  const actual = jest.requireActual('@/lib/m3u8-downloader');
  return { ...actual, downloadM3U8Video: jest.fn(), parseM3U8: jest.fn() };
});
jest.mock('@/lib/mp4-transmuxer', () => ({
  StreamingTransmuxer: jest.fn(),
  transmuxTSToMP4: jest.fn(),
}));

function task(title: string): M3U8Task {
  return {
    title,
    url: `https://cdn.test/${title}.m3u8`,
    type: 'TS',
    tsUrlList: ['https://cdn.test/1.ts'],
    finishList: [{ title: '1', status: '' }],
    downloadedSegments: new Map(),
    rangeDownload: { startSegment: 1, endSegment: 1, targetSegment: 1 },
    durationSecond: 5,
    segmentDurations: [5],
    finishNum: 0,
    errorNum: 0,
  } as M3U8Task;
}
function add(title: string) {
  const parsedTask = task(title);
  window.dispatchEvent(
    new CustomEvent('addDownloadTask', {
      detail: {
        url: parsedTask.url,
        title,
        downloadType: 'TS',
        concurrency: 16,
        rangeMode: false,
        startSegment: 1,
        endSegment: 1,
        streamMode: 'disabled',
        maxRetries: 3,
        parsedTask,
      },
    })
  );
}

describe('batch download interruptions', () => {
  const finish: Array<() => void> = [];
  beforeEach(() => {
    localStorage.clear();
    jest.clearAllMocks();
    finish.length = 0;
    jest.mocked(downloadM3U8Video).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish.push(resolve);
        })
    );
    jest
      .mocked(parseM3U8)
      .mockImplementation(async (url) =>
        task(url.split('/').pop() || 'parsed')
      );
  });
  it('saves serializable config without parsed buffers or live controllers', async () => {
    render(<DownloadManager isOpen onClose={() => undefined} />);
    act(() => {
      add('one');
    });
    await waitFor(() => expect(downloadM3U8Video).toHaveBeenCalledTimes(1));
    const saved = JSON.parse(localStorage.getItem('downloadTasks') || '[]')[0];
    expect(saved.parsedTask).toBeUndefined();
    expect(saved.completeStreamRef).toBeUndefined();
    expect(saved.abortController).toBeUndefined();
    expect(saved.config.parsedTask).toBeUndefined();
    expect(saved.config.maxRetries).toBe(3);
  });
  it('Start All does not replace the controller of an already queued task', async () => {
    render(<DownloadManager isOpen onClose={() => undefined} />);
    act(() => {
      add('one');
      add('two');
      add('three');
      add('four');
    });
    await waitFor(() => expect(downloadM3U8Video).toHaveBeenCalledTimes(3));
    fireEvent.click(screen.getByRole('button', { name: '全部開始' }));
    expect(parseM3U8).not.toHaveBeenCalled();
    await act(async () => {
      finish[0]();
    });
    await waitFor(() => expect(downloadM3U8Video).toHaveBeenCalledTimes(4));
    const fourthSignal = jest.mocked(downloadM3U8Video).mock.calls[3][2];
    fireEvent.click(screen.getAllByTitle('刪除')[3]);
    expect(fourthSignal?.aborted).toBe(true);
  });
  it('discards legacy serialized parsed tasks and reparses before resume', async () => {
    localStorage.setItem(
      'downloadTasks',
      JSON.stringify([
        {
          id: 'legacy',
          url: 'https://cdn.test/legacy.m3u8',
          title: 'legacy',
          status: 'paused',
          progress: 50,
          current: 1,
          total: 2,
          parsedTask: { ...task('legacy'), downloadedSegments: {} },
          completeStreamRef: {},
          pauseResumeController: {},
          config: {
            downloadType: 'TS',
            concurrency: 16,
            rangeMode: false,
            startSegment: 1,
            endSegment: 1,
            streamMode: 'disabled',
            maxRetries: 7,
            parsedTask: { downloadedSegments: {} },
          },
        },
      ])
    );
    render(<DownloadManager isOpen onClose={() => undefined} />);
    fireEvent.click(await screen.findByTitle('開始/繼續'));
    await waitFor(() => expect(downloadM3U8Video).toHaveBeenCalledTimes(1));
    expect(parseM3U8).toHaveBeenCalledWith('https://cdn.test/legacy.m3u8');
    expect(jest.mocked(downloadM3U8Video).mock.calls[0][6]).toBe(7);
    expect(
      jest.mocked(downloadM3U8Video).mock.calls[0][0].downloadedSegments
    ).toBeInstanceOf(Map);
  });
  it('deleting queued work prevents it from starting later', async () => {
    render(<DownloadManager isOpen onClose={() => undefined} />);
    act(() => {
      add('one');
      add('two');
      add('three');
      add('four');
    });
    await waitFor(() => expect(downloadM3U8Video).toHaveBeenCalledTimes(3));
    fireEvent.click(screen.getAllByTitle('刪除')[3]);
    await act(async () => {
      finish[0]();
    });
    expect(downloadM3U8Video).toHaveBeenCalledTimes(3);
    expect(screen.queryByText('four')).not.toBeInTheDocument();
  });
});
