import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {act, render, screen, waitFor} from "@testing-library/react";
import {MemoryRouter, Route, Routes} from "react-router";
import BackupDetailPage from "../../../../src/routes/app/stacks/backups/[backupId]";
import {getBackup, type BackupRecord} from "@/lib/backups-api";
import {useBackupStream, type BackupStreamStatus} from "@/hooks/use-backup-stream";
import {SidebarProvider} from "@/components/ui/sidebar";

vi.mock("@/lib/backups-api", () => ({
    getBackup: vi.fn(),
}));

vi.mock("@/hooks/use-backup-stream", () => ({
    useBackupStream: vi.fn(),
}));

const mockGetBackup = vi.mocked(getBackup);
const mockUseBackupStream = vi.mocked(useBackupStream);

// Mirrors the page's private BACKUP_RESYNC_POLL_INTERVAL_MS / BACKUP_RESYNC_MAX_POLLS
// constants — not exported, so the poll-bound tests below assert against these
// literal values rather than importing them.
const POLL_INTERVAL_MS = 5000;
const MAX_POLLS = 60;

function makeBackup(overrides: Partial<BackupRecord> = {}): BackupRecord {
    return {
        id: "b1",
        stackId: "s1",
        resticSnapshotId: "abcdef1234567890",
        sizeBytes: null,
        trigger: "MANUAL",
        status: "IN_PROGRESS",
        errorMessage: null,
        logLines: [],
        startedAt: "2026-08-30T10:00:00Z",
        completedAt: null,
        createdAt: "2026-08-30T10:00:00Z",
        ...overrides,
    };
}

function setStream(lines: string[], status: BackupStreamStatus) {
    mockUseBackupStream.mockReturnValue({lines, status});
}

function Page({backupId = "b1"}: {backupId?: string} = {}) {
    return (
        <SidebarProvider>
            <MemoryRouter initialEntries={[`/stacks/s1/backups/${backupId}`]}>
                <Routes>
                    <Route path="/stacks/:id/backups/:backupId" element={<BackupDetailPage />} />
                </Routes>
            </MemoryRouter>
        </SidebarProvider>
    );
}

beforeEach(() => {
    mockGetBackup.mockReset();
    mockUseBackupStream.mockReset();
    setStream([], "streaming");
    vi.spyOn(console, "warn").mockImplementation(() => {});

    // jsdom does not implement matchMedia; SidebarProvider's mobile-detection
    // hook (used by the Page shell this route renders into) requires it.
    if (typeof window.matchMedia !== "function") {
        window.matchMedia = vi.fn().mockImplementation((query: string) => ({
            matches: false,
            media: query,
            onchange: null,
            addListener: vi.fn(),
            removeListener: vi.fn(),
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
            dispatchEvent: vi.fn(),
        }));
    }
});

afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
});

describe("BackupDetailPage", () => {
    it("requests the record once on mount and renders its status badge", async () => {
        mockGetBackup.mockResolvedValueOnce(makeBackup({status: "IN_PROGRESS"}));

        render(<Page />);

        expect(await screen.findByText("In Progress")).toBeInTheDocument();
        expect(mockGetBackup).toHaveBeenCalledTimes(1);
    });

    it("resyncs and renders the refetched status when the stream moves from streaming to completed", async () => {
        mockGetBackup.mockResolvedValueOnce(makeBackup({status: "IN_PROGRESS"}));
        const {rerender} = render(<Page />);
        await screen.findByText("In Progress");

        mockGetBackup.mockResolvedValueOnce(makeBackup({status: "COMPLETED", logLines: ["done"]}));
        setStream([], "completed");
        rerender(<Page />);

        expect(await screen.findByText("Completed")).toBeInTheDocument();
        expect(mockGetBackup).toHaveBeenCalledTimes(2);
    });

    it("resyncs on failed and renders the destructive alert once the refetched record is FAILED with an error message", async () => {
        mockGetBackup.mockResolvedValueOnce(makeBackup({status: "IN_PROGRESS"}));
        const {rerender} = render(<Page />);
        await screen.findByText("In Progress");

        mockGetBackup.mockResolvedValueOnce(
            makeBackup({status: "FAILED", errorMessage: "restic exited 1", logLines: ["[error] restic exited 1"]}),
        );
        setStream([], "failed");
        rerender(<Page />);

        expect(await screen.findByText(/Backup failed: restic exited 1/)).toBeInTheDocument();
        expect(mockGetBackup).toHaveBeenCalledTimes(2);
    });

    it("resyncs when the stream moves to disconnected", async () => {
        mockGetBackup.mockResolvedValueOnce(makeBackup({status: "IN_PROGRESS"}));
        const {rerender} = render(<Page />);
        await screen.findByText("In Progress");

        mockGetBackup.mockResolvedValueOnce(makeBackup({status: "IN_PROGRESS"}));
        setStream([], "disconnected");
        rerender(<Page />);

        await waitFor(() => expect(mockGetBackup).toHaveBeenCalledTimes(2));
    });

    it("makes exactly two requests in total once the refetched record is terminal", async () => {
        mockGetBackup.mockResolvedValueOnce(makeBackup({status: "IN_PROGRESS"}));
        const {rerender} = render(<Page />);
        await screen.findByText("In Progress");
        expect(mockGetBackup).toHaveBeenCalledTimes(1);

        mockGetBackup.mockResolvedValueOnce(makeBackup({status: "COMPLETED"}));
        setStream([], "completed");
        rerender(<Page />);
        await screen.findByText("Completed");
        expect(mockGetBackup).toHaveBeenCalledTimes(2);

        rerender(<Page />);
        rerender(<Page />);
        await waitFor(() => expect(mockGetBackup).toHaveBeenCalledTimes(2));
    });

    it("leaves the previously rendered record on screen when a refetch rejects", async () => {
        mockGetBackup.mockResolvedValueOnce(makeBackup({status: "IN_PROGRESS"}));
        const {rerender} = render(<Page />);
        await screen.findByText("In Progress");

        mockGetBackup.mockRejectedValueOnce(new Error("network down"));
        setStream([], "disconnected");
        rerender(<Page />);

        await waitFor(() => expect(mockGetBackup).toHaveBeenCalledTimes(2));
        expect(screen.getByText("In Progress")).toBeInTheDocument();
        expect(screen.queryByText("Backup not found")).not.toBeInTheDocument();
    });

    it("renders log lines from the record, not the stream, once the record is terminal", async () => {
        mockGetBackup.mockResolvedValueOnce(makeBackup({status: "IN_PROGRESS", logLines: []}));
        setStream(["streamed-line"], "streaming");
        const {rerender} = render(<Page />);
        expect(await screen.findByText("streamed-line")).toBeInTheDocument();

        mockGetBackup.mockResolvedValueOnce(makeBackup({status: "COMPLETED", logLines: ["persisted-line"]}));
        setStream(["streamed-line"], "completed");
        rerender(<Page />);

        expect(await screen.findByText("persisted-line")).toBeInTheDocument();
        expect(screen.queryByText("streamed-line")).not.toBeInTheDocument();
    });

    it("renders the failure-specific empty message for a FAILED record with no captured lines", async () => {
        mockGetBackup.mockResolvedValueOnce(
            makeBackup({status: "FAILED", errorMessage: "boom", logLines: []}),
        );

        render(<Page />);

        expect(
            await screen.findByText("No log output was captured for this backup."),
        ).toBeInTheDocument();
    });

    it("renders the original empty message for a record still IN_PROGRESS with no lines yet", async () => {
        mockGetBackup.mockResolvedValueOnce(makeBackup({status: "IN_PROGRESS", logLines: []}));
        setStream([], "streaming");

        render(<Page />);

        expect(await screen.findByText("No output yet...")).toBeInTheDocument();
    });

    it("switches autoScroll off once the stream is no longer streaming", async () => {
        mockGetBackup.mockResolvedValueOnce(makeBackup({status: "IN_PROGRESS"}));
        setStream([], "streaming");
        const {rerender, container} = render(<Page />);
        await screen.findByText("In Progress");
        expect(container.querySelector("[aria-live]")).toHaveAttribute("aria-live", "polite");

        mockGetBackup.mockResolvedValueOnce(makeBackup({status: "COMPLETED"}));
        setStream([], "completed");
        rerender(<Page />);

        await screen.findByText("Completed");
        expect(container.querySelector("[aria-live]")).toHaveAttribute("aria-live", "off");
    });

    describe("CR-03: non-blank title/breadcrumb", () => {
        const longBackupId = "b1234567890abcdef1234567890";

        it("renders a page title built from the first eight characters of the route's backupId when resticSnapshotId is empty", async () => {
            mockGetBackup.mockResolvedValueOnce(
                makeBackup({resticSnapshotId: "", status: "IN_PROGRESS", trigger: "MANUAL"}),
            );

            render(<Page backupId={longBackupId} />);

            expect(await screen.findByText(`Backup #${longBackupId.slice(0, 8)}`)).toBeInTheDocument();
        });

        it("renders the same fallback behind the Restore prefix for a RESTORE-trigger record with an empty resticSnapshotId", async () => {
            mockGetBackup.mockResolvedValueOnce(
                makeBackup({resticSnapshotId: "", status: "IN_PROGRESS", trigger: "RESTORE"}),
            );

            render(<Page backupId={longBackupId} />);

            expect(await screen.findByText(`Restore #${longBackupId.slice(0, 8)}`)).toBeInTheDocument();
        });

        it("still renders the first eight characters of a real resticSnapshotId, unchanged", async () => {
            mockGetBackup.mockResolvedValueOnce(
                makeBackup({resticSnapshotId: "abcdef1234567890", status: "COMPLETED"}),
            );

            render(<Page backupId={longBackupId} />);

            expect(await screen.findByText("Backup #abcdef12")).toBeInTheDocument();
        });
    });

    describe("CR-01: bounded poll while disconnected", () => {
        it("requests the record immediately on moving to disconnected, then again on every poll interval", async () => {
            vi.useFakeTimers();
            mockGetBackup.mockResolvedValueOnce(makeBackup({status: "IN_PROGRESS"}));
            const {rerender} = render(<Page />);
            await act(async () => {
                await vi.advanceTimersByTimeAsync(0);
            });
            expect(mockGetBackup).toHaveBeenCalledTimes(1);

            mockGetBackup.mockResolvedValue(makeBackup({status: "IN_PROGRESS"}));
            setStream([], "disconnected");
            rerender(<Page />);

            await act(async () => {
                await vi.advanceTimersByTimeAsync(0);
            });
            expect(mockGetBackup).toHaveBeenCalledTimes(2);

            await act(async () => {
                await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
            });
            expect(mockGetBackup).toHaveBeenCalledTimes(3);

            await act(async () => {
                await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
            });
            expect(mockGetBackup).toHaveBeenCalledTimes(4);
        });

        it("stops polling once a refetched record is no longer IN_PROGRESS", async () => {
            vi.useFakeTimers();
            mockGetBackup.mockResolvedValueOnce(makeBackup({status: "IN_PROGRESS"}));
            const {rerender} = render(<Page />);
            await act(async () => {
                await vi.advanceTimersByTimeAsync(0);
            });

            mockGetBackup.mockResolvedValueOnce(makeBackup({status: "COMPLETED"}));
            setStream([], "disconnected");
            rerender(<Page />);

            await act(async () => {
                await vi.advanceTimersByTimeAsync(0);
            });
            expect(mockGetBackup).toHaveBeenCalledTimes(2);

            // The refetched record is COMPLETED, so isStreaming is now false —
            // advancing further must not trigger any additional poll.
            await act(async () => {
                await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 3);
            });
            expect(mockGetBackup).toHaveBeenCalledTimes(2);
        });

        it("stops polling once the stream returns to streaming", async () => {
            vi.useFakeTimers();
            mockGetBackup.mockResolvedValueOnce(makeBackup({status: "IN_PROGRESS"}));
            const {rerender} = render(<Page />);
            await act(async () => {
                await vi.advanceTimersByTimeAsync(0);
            });

            mockGetBackup.mockResolvedValue(makeBackup({status: "IN_PROGRESS"}));
            setStream([], "disconnected");
            rerender(<Page />);
            await act(async () => {
                await vi.advanceTimersByTimeAsync(0);
            });
            expect(mockGetBackup).toHaveBeenCalledTimes(2);

            setStream([], "streaming");
            rerender(<Page />);

            await act(async () => {
                await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 3);
            });
            expect(mockGetBackup).toHaveBeenCalledTimes(2);
        });

        it("stops polling on unmount", async () => {
            vi.useFakeTimers();
            mockGetBackup.mockResolvedValueOnce(makeBackup({status: "IN_PROGRESS"}));
            const {rerender, unmount} = render(<Page />);
            await act(async () => {
                await vi.advanceTimersByTimeAsync(0);
            });

            mockGetBackup.mockResolvedValue(makeBackup({status: "IN_PROGRESS"}));
            setStream([], "disconnected");
            rerender(<Page />);
            await act(async () => {
                await vi.advanceTimersByTimeAsync(0);
            });
            expect(mockGetBackup).toHaveBeenCalledTimes(2);

            unmount();

            await act(async () => {
                await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 3);
            });
            expect(mockGetBackup).toHaveBeenCalledTimes(2);
        });

        it("stops after the configured maximum number of intervals even if the record never leaves IN_PROGRESS", async () => {
            vi.useFakeTimers();
            mockGetBackup.mockResolvedValueOnce(makeBackup({status: "IN_PROGRESS"}));
            const {rerender} = render(<Page />);
            await act(async () => {
                await vi.advanceTimersByTimeAsync(0);
            });

            mockGetBackup.mockResolvedValue(makeBackup({status: "IN_PROGRESS"}));
            setStream([], "disconnected");
            rerender(<Page />);

            // 1 mount call + 1 immediate poll call + (MAX_POLLS - 1) interval ticks
            // that still fetch (the MAX_POLLS-th tick clears the interval without
            // fetching) = MAX_POLLS + 1 total calls, and it must stay there.
            await act(async () => {
                await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * (MAX_POLLS + 10));
            });
            expect(mockGetBackup).toHaveBeenCalledTimes(MAX_POLLS + 1);

            await act(async () => {
                await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 10);
            });
            expect(mockGetBackup).toHaveBeenCalledTimes(MAX_POLLS + 1);
        });

        it("a completed stream still costs exactly two requests in total after several poll intervals have elapsed", async () => {
            vi.useFakeTimers();
            mockGetBackup.mockResolvedValueOnce(makeBackup({status: "IN_PROGRESS"}));
            const {rerender} = render(<Page />);
            await act(async () => {
                await vi.advanceTimersByTimeAsync(0);
            });

            mockGetBackup.mockResolvedValueOnce(makeBackup({status: "COMPLETED"}));
            setStream([], "completed");
            rerender(<Page />);
            await act(async () => {
                await vi.advanceTimersByTimeAsync(0);
            });
            expect(mockGetBackup).toHaveBeenCalledTimes(2);

            await act(async () => {
                await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 10);
            });
            expect(mockGetBackup).toHaveBeenCalledTimes(2);
        });
    });
});
