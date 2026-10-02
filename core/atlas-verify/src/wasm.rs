//! Plain C-ABI exports for `wasm32-unknown-unknown`.
//!
//! No wasm-bindgen: the module imports nothing and the JS side (`js/atlas_verify.mjs`) is a short hand-written
//! loader. Strings cross as UTF-8 bytes the caller writes into memory it got from `atlas_alloc`. Results are kept in
//! module-level cells the caller reads right after the call (the module is single-threaded).

use crate::{fakes_for, find_span, json_string, normalize};
use std::cell::{Cell, RefCell};

thread_local! {
    static OUT: RefCell<Vec<u8>> = const { RefCell::new(Vec::new()) };
    static START: Cell<f64> = const { Cell::new(f64::NAN) };
    static END: Cell<f64> = const { Cell::new(f64::NAN) };
}

/// Reserve `len` bytes for the caller to write a UTF-8 string into.
#[no_mangle]
pub extern "C" fn atlas_alloc(len: usize) -> *mut u8 {
    let mut v = Vec::<u8>::with_capacity(len);
    let p = v.as_mut_ptr();
    std::mem::forget(v);
    p
}

/// Release memory from `atlas_alloc`.
///
/// # Safety
/// `ptr` and `len` must be exactly a pair returned by / passed to `atlas_alloc`, freed once.
#[no_mangle]
pub unsafe extern "C" fn atlas_free(ptr: *mut u8, len: usize) {
    drop(Vec::from_raw_parts(ptr, 0, len));
}

unsafe fn read<'a>(ptr: *const u8, len: usize) -> Option<&'a str> {
    let bytes = if len == 0 {
        &[][..]
    } else {
        std::slice::from_raw_parts(ptr, len)
    };
    std::str::from_utf8(bytes).ok()
}

fn set_out(s: String) {
    OUT.with(|o| *o.borrow_mut() = s.into_bytes());
}

/// Returns 1 when the quote is found (read the span with `atlas_span_start` / `atlas_span_end`), 0 when it is not
/// (the TS `null`), -1 when an input was not valid UTF-8.
///
/// # Safety
/// Both pointer/length pairs must describe readable memory.
#[no_mangle]
pub unsafe extern "C" fn atlas_find_span(src: *const u8, src_len: usize, quote: *const u8, quote_len: usize) -> i32 {
    let (Some(s), Some(q)) = (read(src, src_len), read(quote, quote_len)) else {
        return -1;
    };
    match find_span(s, q) {
        None => 0,
        Some(span) => {
            // NaN stands for JS `undefined` / `NaN`, see `Span`.
            START.with(|c| c.set(span.start.map_or(f64::NAN, |v| v as f64)));
            END.with(|c| c.set(span.end.map_or(f64::NAN, |v| v as f64)));
            1
        }
    }
}

#[no_mangle]
pub extern "C" fn atlas_span_start() -> f64 {
    START.with(|c| c.get())
}

#[no_mangle]
pub extern "C" fn atlas_span_end() -> f64 {
    END.with(|c| c.get())
}

/// Normalizes a string; the result is in the output buffer. Returns its byte length, or -1 on invalid UTF-8.
///
/// # Safety
/// The pointer/length pair must describe readable memory.
#[no_mangle]
pub unsafe extern "C" fn atlas_normalize(ptr: *const u8, len: usize) -> i32 {
    let Some(s) = read(ptr, len) else { return -1 };
    let n = normalize(s);
    let l = n.len() as i32;
    set_out(n);
    l
}

/// The planted fakes for one real instruction, as JSON `[{"kind":..,"text":..}]` in the output buffer.
/// Returns the byte length, or -1 on invalid UTF-8.
///
/// # Safety
/// The pointer/length pair must describe readable memory.
#[no_mangle]
pub unsafe extern "C" fn atlas_fakes_for(ptr: *const u8, len: usize) -> i32 {
    let Some(s) = read(ptr, len) else { return -1 };
    let items: Vec<String> = fakes_for(s)
        .into_iter()
        .map(|f| format!("{{\"kind\":{},\"text\":{}}}", json_string(f.kind), json_string(&f.text)))
        .collect();
    let json = format!("[{}]", items.join(","));
    let l = json.len() as i32;
    set_out(json);
    l
}

#[no_mangle]
pub extern "C" fn atlas_out_ptr() -> *const u8 {
    OUT.with(|o| o.borrow().as_ptr())
}
