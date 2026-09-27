import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import NavBar from "@/components/NavBar";

// The phone header collapses the five links into one menu button. These
// guard the button's contract: it names the current page, lists every
// page when open, and closes on Escape or navigation.

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="*" element={<NavBar />} />
      </Routes>
    </MemoryRouter>,
  );

const menuButton = () => screen.getByRole("button", { name: /menu/i });

describe("NavBar phone menu", () => {
  afterEach(cleanup);

  it("names the current page on the closed button", () => {
    renderAt("/research/some-post");
    expect(menuButton()).toHaveTextContent("Research");
    expect(menuButton()).toHaveAttribute("aria-expanded", "false");
  });

  it("lists every page when opened", () => {
    renderAt("/dashboard");
    fireEvent.click(menuButton());

    const menu = document.getElementById(menuButton().getAttribute("aria-controls") ?? "");
    expect(menu).not.toBeNull();
    const labels = Array.from(menu?.querySelectorAll("a") ?? []).map((a) => a.textContent);
    expect(labels).toEqual(["Dashboard", "Compare", "Benchmark", "Research", "Rumors", "GitHub"]);
  });

  it("closes on Escape", () => {
    renderAt("/compare");
    fireEvent.click(menuButton());
    fireEvent.keyDown(window, { key: "Escape" });
    expect(menuButton()).toHaveAttribute("aria-expanded", "false");
  });

  it("closes after following a link", () => {
    renderAt("/compare");
    fireEvent.click(menuButton());
    const menu = document.getElementById(menuButton().getAttribute("aria-controls") ?? "");
    const rumors = Array.from(menu?.querySelectorAll("a") ?? []).find((a) => a.textContent === "Rumors");
    fireEvent.click(rumors as HTMLAnchorElement);
    expect(menuButton()).toHaveAttribute("aria-expanded", "false");
    expect(menuButton()).toHaveTextContent("Rumors");
  });
});
