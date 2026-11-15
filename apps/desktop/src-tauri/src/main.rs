//! Avatar Companion desktop shell.
//!
//! A native window around the web app that `apps/web` builds (`frontendDist`, embedded at
//! compile time). The shell's one native behaviour is where links go. In an app window a
//! plain link to another site would replace the app with that page and leave no way back,
//! while a `target="_blank"` link or `window.open` went nowhere: with no handler set, the
//! webview drops the new-window request. So anything that is not one of the app's own pages
//! opens in the system browser or mail client, and the window stays where it was.

// Hide the console window on Windows release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::webview::NewWindowResponse;
use tauri::{AppHandle, Runtime, Url, WebviewWindowBuilder};
use tauri_plugin_opener::OpenerExt;

/// True for the app's own pages: the bundled web app, and the Vite dev server under `tauri dev`.
///
/// macOS and Linux serve the bundle from `tauri://localhost`; Windows serves it from
/// `http://tauri.localhost` (`https://` if `useHttpsScheme` is ever turned on).
fn is_app_page(url: &Url, dev_url: Option<&Url>) -> bool {
    match url.scheme() {
        "tauri" => true,
        "http" | "https" if url.host_str() == Some("tauri.localhost") => true,
        _ => dev_url.is_some_and(|dev| url.origin() == dev.origin()),
    }
}

/// True for links that belong in the system browser or mail client. Everything else that
/// is not an app page (about:, data:, blob:) stays in the window, where the web app put it.
fn opens_in_browser(url: &Url) -> bool {
    matches!(url.scheme(), "http" | "https" | "mailto")
}

/// Whether the webview may follow a navigation. A link out of the app is handed to the
/// system browser and the navigation is cancelled.
fn allow_navigation<R: Runtime>(app: &AppHandle<R>, url: &Url, dev_url: Option<&Url>) -> bool {
    if is_app_page(url, dev_url) || !opens_in_browser(url) {
        return true;
    }
    open_in_browser(app, url);
    false
}

fn open_in_browser<R: Runtime>(app: &AppHandle<R>, url: &Url) {
    if let Err(err) = app.opener().open_url(url.as_str(), None::<&str>) {
        eprintln!("could not open {url} in the system browser: {err}");
    }
}

fn main() {
    tauri::Builder::default()
        // The Rust handlers below open every link out of the app. The plugin's own click script
        // would instead send target="_blank" links to its page-facing `open_url` command, which
        // this app doesn't grant (capabilities/default.json), so those links would do nothing.
        .plugin(tauri_plugin_opener::Builder::new().open_js_links_on_click(false).build())
        .setup(|app| {
            let handle = app.handle().clone();
            // The window is declared in tauri.conf.json with `create: false` and built here,
            // because the two link handlers can only be attached to a builder.
            let config = app
                .config()
                .app
                .windows
                .iter()
                .find(|window| window.label == "main")
                .cloned()
                .expect("tauri.conf.json declares the main window");
            let dev_url = if tauri::is_dev() {
                app.config().build.dev_url.clone()
            } else {
                None
            };

            let nav_app = handle.clone();
            let popup_app = handle.clone();
            WebviewWindowBuilder::from_config(&handle, &config)?
                .on_navigation(move |url| allow_navigation(&nav_app, url, dev_url.as_ref()))
                // A target="_blank" link, a modifier-click or `window.open`: never a second app
                // window. A web link goes to the browser, the same as a plain click.
                .on_new_window(move |url, _features| {
                    if opens_in_browser(&url) {
                        open_in_browser(&popup_app, &url);
                    }
                    NewWindowResponse::Deny
                })
                .build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running the Avatar Companion desktop shell");
}

#[cfg(test)]
mod tests {
    use super::*;

    fn url(s: &str) -> Url {
        Url::parse(s).unwrap()
    }

    #[test]
    fn the_bundled_web_app_is_an_app_page_on_every_platform() {
        for page in [
            "tauri://localhost/",
            "tauri://localhost/index.html",
            "http://tauri.localhost/",
            "http://tauri.localhost/?demo=1#settings",
            "https://tauri.localhost/index.html",
        ] {
            assert!(is_app_page(&url(page), None), "{page}");
        }
    }

    #[test]
    fn the_dev_server_is_an_app_page_only_when_it_is_the_dev_url() {
        let dev = url("http://localhost:5173");
        assert!(is_app_page(&url("http://localhost:5173/"), Some(&dev)));
        assert!(is_app_page(&url("http://localhost:5173/harness.html"), Some(&dev)));
        assert!(!is_app_page(&url("http://localhost:5173/"), None));
        // A server the user picked in Settings is not a page the window should show, even on
        // this computer (Ollama on its default port, say).
        assert!(!is_app_page(&url("http://localhost:11434/"), Some(&dev)));
    }

    #[test]
    fn links_out_of_the_app_go_to_the_browser() {
        for link in [
            "https://example.com/",
            "http://example.com/",
            "https://ci.computer",
            "https://ollama.com/download",
            "mailto:someone@example.com",
            // The hosted web app is a website like any other: the app shows its bundled copy.
            "https://avatar.ci.computer/",
        ] {
            let link = url(link);
            assert!(!is_app_page(&link, None), "{link}");
            assert!(opens_in_browser(&link), "{link}");
        }
    }

    #[test]
    fn lookalike_hosts_are_not_app_pages() {
        for link in [
            "http://tauri.localhost.example.com/",
            "http://tauri.localhost@example.com/",
            "https://localhost/",
            "http://example.com/tauri.localhost",
        ] {
            assert!(!is_app_page(&url(link), None), "{link}");
        }
    }

    #[test]
    fn non_web_schemes_stay_in_the_window() {
        for link in ["about:blank", "data:text/plain,hi", "blob:http://tauri.localhost/1234"] {
            assert!(!opens_in_browser(&url(link)), "{link}");
        }
    }
}
