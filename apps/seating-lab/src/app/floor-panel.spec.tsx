import { StrictMode, useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ResponseException } from 'pdfjs-dist';
import type { SeatingFloorResult } from '@tickets/seating';

import { FloorPanel } from './floor-panel';

const { mockedApi, mockedRenderPdfPage } = vi.hoisted(() => ({
  mockedApi: {
    listFloors: vi.fn(),
    getFloor: vi.fn(),
    uploadFile: vi.fn(),
    updateFloor: vi.fn(),
    getConfiguration: vi.fn(),
  },
  mockedRenderPdfPage: vi.fn(),
}));

vi.mock('./state', () => ({ useLab: () => ({ api: mockedApi }) }));
vi.mock('./pdf-background', () => ({
  renderPdfPage: mockedRenderPdfPage,
  pdfCalibrationTransform: vi.fn(),
}));
vi.mock('./background-wizard', () => ({
  BackgroundWizard: ({ onAttach }: { onAttach: (file: File) => void }) => (
    <input
      aria-label='Файл PDF'
      type='file'
      onChange={(event) => {
        const file = event.currentTarget.files?.[0];
        if (file) onAttach(file);
      }}
    />
  ),
}));

const floors = [
  { id: 'floor-a', name: 'Партер', versions: { floorVersion: 3 }, isDefault: true, background: null },
  { id: 'floor-b', name: 'Балкон', versions: { floorVersion: 2 }, isDefault: false, background: null },
] as SeatingFloorResult[];

function floorWithPdf(url: string, urlExpiresAt: string, floor = floors[0]): SeatingFloorResult {
  return {
    ...floor,
    background: {
      file: { fileId: 'pdf-a', fileName: 'plan.pdf', contentType: 'application/pdf', sizeBytes: 10,
        dominantColors: [], url, urlExpiresAt },
      page: 1,
      calibration: null,
      placement: { originX: 0, originY: 0, rotationDegrees: 0 },
    },
  };
}

function Harness() {
  const [selectedFloorId, setSelectedFloorId] = useState('floor-a');
  return <FloorPanel
    configurationId='config-a'
    configurationVersion={5}
    selectedFloorId={selectedFloorId}
    onFloorSelect={setSelectedFloorId}
    otherDirtyZoneCount={0}
    onConfigurationChange={() => undefined}
    onBackgroundChange={() => undefined}
  />;
}

describe('PDF подложка этажа', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedApi.listFloors.mockResolvedValue({ items: floors, totalItems: floors.length });
    mockedApi.uploadFile.mockResolvedValue('uploaded-pdf');
    mockedApi.getConfiguration.mockResolvedValue({});
    mockedRenderPdfPage.mockResolvedValue({ canvas: document.createElement('canvas'), viewport: {}, numPages: 1 });
  });

  it('renews an expiring signed PDF URL before requesting its bytes', async () => {
    const expired = floorWithPdf('https://files.example/old?secret=old', '2000-01-01T00:00:00Z', floors[1]);
    const fresh = floorWithPdf('https://files.example/new?secret=new', '2099-01-01T00:00:00Z', floors[1]);
    mockedApi.listFloors.mockResolvedValue({ items: [floors[0], expired], totalItems: 2 });
    mockedApi.getFloor.mockResolvedValue(fresh);

    render(<StrictMode><Harness /></StrictMode>);
    fireEvent.change(await screen.findByRole('combobox', { name: 'Этаж' }), { target: { value: 'floor-b' } });

    await waitFor(() => expect(mockedRenderPdfPage).toHaveBeenCalledWith(fresh.background?.file.url, 1));
    expect(mockedApi.getFloor).toHaveBeenCalledWith('config-a', 'floor-b');
    expect(mockedRenderPdfPage).toHaveBeenCalledTimes(1);
  });

  it('renews a forbidden PDF URL once and never exposes its signed query on repeated 403', async () => {
    const old = floorWithPdf('https://files.example/old?secret=old', '2099-01-01T00:00:00Z');
    const fresh = floorWithPdf('https://files.example/new?secret=new', '2099-01-01T00:00:00Z');
    mockedApi.listFloors.mockResolvedValue({ items: [old], totalItems: 1 });
    mockedApi.getFloor.mockResolvedValue(fresh);
    mockedRenderPdfPage.mockRejectedValue(new ResponseException(
      'Unexpected server response (403) while retrieving PDF "https://files.example/old?secret=old".', 403, false));

    render(<Harness />);

    expect(await screen.findByRole('alert')).toHaveProperty('textContent',
      'Не удалось загрузить PDF-план после обновления ссылки. Повторите загрузку.');
    expect(mockedApi.getFloor).toHaveBeenCalledTimes(1);
    expect(mockedRenderPdfPage.mock.calls.map(([url]) => url)).toEqual([
      old.background?.file.url, fresh.background?.file.url,
    ]);
    expect(document.body.textContent).not.toContain('secret=old');
  });

  it('retries a 403 with fresh metadata and renders the PDF when the new URL works', async () => {
    const old = floorWithPdf('https://files.example/old', '2099-01-01T00:00:00Z');
    const fresh = floorWithPdf('https://files.example/new', '2099-01-01T00:00:00Z');
    mockedApi.listFloors.mockResolvedValue({ items: [old], totalItems: 1 });
    mockedApi.getFloor.mockResolvedValue(fresh);
    mockedRenderPdfPage.mockRejectedValueOnce(new ResponseException('Forbidden', 403, false));

    render(<Harness />);

    await waitFor(() => expect(mockedRenderPdfPage).toHaveBeenCalledTimes(2));
    expect(mockedRenderPdfPage.mock.calls.map(([url]) => url)).toEqual([
      old.background?.file.url, fresh.background?.file.url,
    ]);
    expect(mockedApi.getFloor).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('retries attaching an uploaded PDF to the same floor without uploading it again', async () => {
    mockedApi.updateFloor.mockRejectedValueOnce(new Error('Temporary failure'))
      .mockResolvedValueOnce({});
    render(<Harness />);
    await screen.findByText('Партер');
    fireEvent.click(screen.getByRole('button', { name: 'Загрузить план помещения…' }));
    fireEvent.change(screen.getByLabelText('Файл PDF'), {
      target: { files: [new File(['%PDF-'], 'plan.pdf', { type: 'application/pdf' })] },
    });

    const retry = await screen.findByRole('button', { name: 'Повторить прикрепление PDF' });
    expect(screen.getByText(/PDF загружен: plan\.pdf · ID uploaded-pdf/)).toBeTruthy();
    fireEvent.click(retry);
    await waitFor(() => expect(mockedApi.updateFloor).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Повторить прикрепление PDF' })).toBeNull());

    expect(mockedApi.uploadFile).toHaveBeenCalledTimes(1);
    expect(mockedApi.updateFloor.mock.calls[0]).toEqual(mockedApi.updateFloor.mock.calls[1]);
    expect(mockedApi.updateFloor.mock.calls[0][2]).toMatchObject({
      expectedFloorVersion: 3, background: { file: 'uploaded-pdf', page: 1, calibration: null },
    });
  });

  it('keeps the retry for its original floor while switching away and back', async () => {
    mockedApi.updateFloor.mockRejectedValueOnce(new Error('Temporary failure'))
      .mockResolvedValueOnce({});
    render(<Harness />);
    await screen.findByText('Партер');
    fireEvent.click(screen.getByRole('button', { name: 'Загрузить план помещения…' }));
    fireEvent.change(screen.getByLabelText('Файл PDF'), {
      target: { files: [new File(['%PDF-'], 'plan.pdf', { type: 'application/pdf' })] },
    });
    await screen.findByRole('button', { name: 'Повторить прикрепление PDF' });
    fireEvent.change(screen.getByRole('combobox', { name: 'Этаж' }), { target: { value: 'floor-b' } });
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Повторить прикрепление PDF' })).toBeNull());
    fireEvent.change(screen.getByRole('combobox', { name: 'Этаж' }), { target: { value: 'floor-a' } });
    const retry = await screen.findByRole('button', { name: 'Повторить прикрепление PDF' });
    expect(screen.getByText(/PDF загружен: plan\.pdf · ID uploaded-pdf/)).toBeTruthy();
    fireEvent.click(retry);
    await waitFor(() => expect(mockedApi.updateFloor).toHaveBeenCalledTimes(2));
    expect(mockedApi.uploadFile).toHaveBeenCalledTimes(1);
    expect(mockedApi.updateFloor.mock.calls[0]).toEqual(mockedApi.updateFloor.mock.calls[1]);
  });
});
