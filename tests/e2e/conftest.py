"""Pytest configuration for E2E tests."""
import pytest
import asyncio
from playwright.async_api import async_playwright, Browser, BrowserContext, Page


@pytest.fixture(scope="session")
def event_loop():
    """Create event loop for async tests."""
    loop = asyncio.get_event_loop_policy().new_event_loop()
    yield loop
    loop.close()


@pytest.fixture(scope="session")
async def browser():
    """Launch browser for tests."""
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        yield browser
        await browser.close()


@pytest.fixture
async def context(browser: Browser):
    """Create browser context."""
    context = await browser.new_context(
        viewport={"width": 1920, "height": 1080},
        locale="ru-RU"
    )
    yield context
    await context.close()


@pytest.fixture
async def page(context: BrowserContext):
    """Create new page."""
    page = await context.new_page()
    yield page
    await page.close()


@pytest.fixture
def base_url():
    """Base URL for tests."""
    return "http://localhost:5173"


@pytest.fixture
def api_url():
    """API URL for tests."""
    return "http://localhost:8000"
