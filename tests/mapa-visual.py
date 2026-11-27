"""Verifica el pintado real tras un clic o un toque, con Playwright para Python.

Inicia node scripts/servidor.mjs y ejecuta python3 tests/mapa-visual.py.
"""
import argparse
import base64

from playwright.sync_api import sync_playwright


def interior_visible(shape):
    """La caja de una provincia irregular puede tener su centro en otra provincia."""
    return shape.evaluate("""path => {
        const box = path.getBoundingClientRect();
        const map = path.ownerSVGElement.getBoundingClientRect();
        const right = Math.min(box.right, map.right, innerWidth);
        const bottom = Math.min(box.bottom, map.bottom, innerHeight);
        for (let x = Math.max(box.left, map.left, 0) + 2; x < right; x += 4) {
            for (let y = Math.max(box.top, map.top, 0) + 2; y < bottom; y += 4) {
                if (document.elementFromPoint(x, y) === path) return [x, y];
            }
        }
        return null;
    }""")


def painted_land(page, screenshot):
    # Compara la captura con la paleta del mapa. Un contorno nativo de Chromium
    # puede ocultar las provincias aunque sus colores SVG calculados sean correctos.
    return page.evaluate(r"""async data => {
        const pixels = new Image();
        pixels.src = 'data:image/png;base64,' + data;
        await pixels.decode();
        const canvas = document.createElement('canvas');
        canvas.width = pixels.width;
        canvas.height = pixels.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(pixels, 0, 0);
        const {data: rgba} = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const rgb = path => getComputedStyle(path).fill.match(/\d+/g).slice(0, 3).join(',');
        const chosen = rgb(document.querySelector('.province-fill.is-selected'));
        const others = new Set(Array.from(document.querySelectorAll('.province-fill:not(.is-selected)'), rgb));
        let selected = 0, neighbours = 0, total = 0;
        for (let y = 0; y < canvas.height; y += 4) {
            for (let x = 0; x < canvas.width; x += 4) {
                const i = 4 * (canvas.width * y + x);
                const ink = [rgba[i], rgba[i + 1], rgba[i + 2]].join(',');
                if (ink === chosen) selected++;
                else if (others.has(ink)) neighbours++;
                total++;
            }
        }
        return {selected: selected / total, neighbours: neighbours / total};
    }""", base64.b64encode(screenshot).decode("ascii"))


def verify(browser, url, width):
    mobile = width < 500
    context = browser.new_context(viewport={"width": width, "height": 844},
                                  is_mobile=mobile, has_touch=mobile)
    try:
        page = context.new_page()
        page.goto(url, wait_until="domcontentloaded")
        page.locator('[data-layer="lluvias"]').click()
        map_svg = page.locator("#map")
        map_svg.scroll_into_view_if_needed()
        activate = page.touchscreen.tap if mobile else page.mouse.click
        for selector in ['#regions [data-region="Piura"]', '.local-area[data-area="2004"]']:
            shape = page.locator(selector)
            shape.wait_for(state="attached")
            page.wait_for_function("""selector => {
                const path = document.querySelector(selector);
                return path && path.getBoundingClientRect().width > 12;
            }""", arg=selector)
            # Espera el fin de la transición anterior antes de elegir la coordenada.
            page.wait_for_timeout(500)
            point = interior_visible(shape)
            assert point, selector
            activate(*point)
        page.locator('.local-area.is-selected[data-area="2004"]').wait_for(state="attached")
        page.wait_for_timeout(750)
        # La captura debe hacerse sin enviar ningún movimiento ni trasladar el foco.
        colors = painted_land(page, map_svg.screenshot())
        assert min(colors.values()) > 0.02, (width, colors)
        print(f"{width} px: Morropón y sus provincias vecinas visibles tras seleccionar el polígono.")
    finally:
        context.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default="http://127.0.0.1:4173/")
    parser.add_argument("--executable", help="Ruta a una instalación local de Chrome o Chromium")
    args = parser.parse_args()
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(executable_path=args.executable)
        try:
            for width in (1440, 390):
                verify(browser, args.url, width)
        finally:
            browser.close()
