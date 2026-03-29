/**
 * @vitest-environment jsdom
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { JobsHistoryPanel } from "./JobsHistoryPanel";

const noop = () => {};

describe("JobsHistoryPanel — pagination jobs", () => {
  it("affiche « Chargement… » et désactive le bouton quand loadMoreJobsLoading", () => {
    render(
      <JobsHistoryPanel
        jobs={[]}
        selectedJobId=""
        onFocusJobDetails={noop}
        onOpenLocalPath={noop}
        onCancelJob={noop}
        onDeleteJob={noop}
        jobsPagination={{ hasMore: true, totalInDb: 100 }}
        onLoadMoreJobs={vi.fn()}
        loadMoreJobsLoading
      />,
    );

    const btn = screen.getByRole("button", { name: /chargement/i });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute("aria-busy", "true");
  });
});
