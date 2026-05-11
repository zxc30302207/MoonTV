import { ReadableStream, TransformStream } from 'stream/web';
import { TextDecoder, TextEncoder } from 'util';
import '@testing-library/jest-dom';

Object.assign(global, {
  ReadableStream,
  TextDecoder,
  TextEncoder,
  TransformStream,
});

// Allow router mocks.
// eslint-disable-next-line no-undef
jest.mock('next/router', () => require('next-router-mock'));
