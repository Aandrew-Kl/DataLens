import { render, screen, waitFor } from '@testing-library/react';
import { ToolSection, AnimatedWorkspaceSection, TablePreview } from '@/components/home/workspace-shared';
import { runQuery } from '@/lib/duckdb/client';
import type { ColumnProfile } from '@/types/dataset';

jest.mock('framer-motion');
jest.mock('@/lib/duckdb/client', () => ({
  __esModule: true,
  runQuery: jest.fn(),
}));
jest.mock('@/components/data/data-table', () => ({
  __esModule: true,
  default: (props: { data: unknown[]; columns: string[] }) => (
    <div data-testid='data-table'>
      {props.columns.map((c: string) => <span key={c}>{c}</span>)}
      <span>{props.data.length} rows</span>
    </div>
  ),
}));

const mockedRunQuery = runQuery as jest.MockedFunction<typeof runQuery>;

const columns: ColumnProfile[] = [
  {
    name: 'id',
    type: 'number',
    nullCount: 0,
    uniqueCount: 2,
    sampleValues: [1, 2],
  },
  {
    name: 'name',
    type: 'string',
    nullCount: 0,
    uniqueCount: 2,
    sampleValues: ['Ada', 'Grace'],
  },
];

describe('workspace-shared', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('ToolSection renders title, description, and children', () => {
    render(
      <ToolSection title='Preview data' description='Inspect your rows'>
        <button type='button'>Open table</button>
      </ToolSection>,
    );

    expect(screen.getByRole('heading', { level: 3, name: 'Preview data' })).toBeInTheDocument();
    expect(screen.getByText('Inspect your rows')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open table' })).toBeInTheDocument();
  });

  it('AnimatedWorkspaceSection renders children', () => {
    render(
      <AnimatedWorkspaceSection>
        <div>Animated child</div>
      </AnimatedWorkspaceSection>,
    );

    expect(screen.getByText('Animated child')).toBeInTheDocument();
  });

  it('AnimatedWorkspaceSection uses custom className when provided', () => {
    render(
      <AnimatedWorkspaceSection className='grid gap-4'>
        <div>Animated child</div>
      </AnimatedWorkspaceSection>,
    );

    expect(screen.getByText('Animated child').parentElement).toHaveClass('grid', 'gap-4');
  });

  it('TablePreview shows loading spinner initially', () => {
    mockedRunQuery.mockReturnValue(new Promise(() => undefined));

    const { container } = render(
      <TablePreview tableName='users' columns={columns} />,
    );

    expect(container.querySelector('.animate-spin')).toBeInTheDocument();
  });

  it('TablePreview renders DataTable after query resolves', async () => {
    mockedRunQuery.mockResolvedValueOnce([
      { id: 1, name: 'Ada' },
      { id: 2, name: 'Grace' },
    ]);

    render(<TablePreview tableName='users' columns={columns} />);

    await waitFor(() => expect(screen.getByTestId('data-table')).toBeInTheDocument());

    expect(screen.getByText('id')).toBeInTheDocument();
    expect(screen.getByText('name')).toBeInTheDocument();
    expect(screen.getByText('2 rows')).toBeInTheDocument();
    expect(mockedRunQuery).toHaveBeenCalledWith('SELECT * FROM "users" LIMIT 200');
  });

  it('TablePreview calls onRowsLoaded after loading', async () => {
    const rows = [{ id: 1, name: 'Ada' }];
    const onRowsLoaded = jest.fn();

    mockedRunQuery.mockResolvedValueOnce(rows);

    render(
      <TablePreview
        tableName='users'
        columns={columns}
        onRowsLoaded={onRowsLoaded}
      />,
    );

    await waitFor(() => expect(onRowsLoaded).toHaveBeenCalledWith(rows));
    expect(onRowsLoaded).toHaveBeenCalledTimes(1);
  });

  it('TablePreview handles query errors gracefully', async () => {
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const onRowsLoaded = jest.fn();

    mockedRunQuery.mockRejectedValueOnce(new Error('Query failed'));

    render(
      <TablePreview
        tableName='users'
        columns={columns}
        onRowsLoaded={onRowsLoaded}
      />,
    );

    await waitFor(() => expect(screen.getByTestId('data-table')).toBeInTheDocument());

    expect(screen.getByText('0 rows')).toBeInTheDocument();
    expect(onRowsLoaded).toHaveBeenCalledWith([]);
    expect(consoleErrorSpy).toHaveBeenCalled();

    consoleErrorSpy.mockRestore();
  });
});
