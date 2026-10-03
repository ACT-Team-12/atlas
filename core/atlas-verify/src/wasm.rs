//! Plain C-ABI exports for `wasm32-unknown-unknown`.
//!
//! No wasm-bindgen: the module imports nothing and the JS side (`js/atlas_verify.mjs`) is a short hand-written
//! loader. Strings cross as UTF-8 bytes the caller writes into memory it got from `atlas_alloc`. Results are kept in
//! module-level cells the caller reads right after the call (the module is single-threaded).
//!
//! The instance is cached for the life of the page, so nothing a check copied (the paper, the quotes, their
//! normalized forms) may stay readable in linear memory afterwards. Every heap block is zeroed when it is freed
//! (`ZeroOnFree` below), which covers every intermediate String and Vec and the old block a reallocation leaves; the
//! JS loaders also zero the input buffers they wrote before freeing them, and clear the output buffer once read.

use crate::{fakes_for, find_span, find_spans, json_string, normalize};
use std::alloc::{GlobalAlloc, Layout, System};
use std::cell::{Cell, RefCell};
use std::sync::atomic::{compiler_fence, Ordering};

/// The system allocator, except that a block is overwritten with zeros before it is freed. Volatile writes plus a
/// fence, so the stores are not removed as dead (nothing reads the block before the allocator takes it back).
/// `realloc` keeps the trait's default (allocate, copy, `dealloc` the old block), so a moved block is wiped too.
struct ZeroOnFree;

unsafe impl GlobalAlloc for ZeroOnFree {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        System.alloc(layout)
    }

    unsafe fn alloc_zeroed(&self, layout: Layout) -> *mut u8 {
        System.alloc_zeroed(layout)
    }

    unsafe fn dealloc(&self, ptr: *mut u8, layout: Layout) {
        for i in 0..layout.size() {
            std::ptr::write_volatile(ptr.add(i), 0);
        }
        compiler_fence(Ordering::SeqCst);
        System.dealloc(ptr, layout);
    }
}

#[global_allocator]
static ALLOC: ZeroOnFree = ZeroOnFree;

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
            START.with(|c| c.set(span.start as f64));
            END.with(|c| c.set(span.end as f64));
            1
        }
    }
}

/// Every quote against one source, which is mapped once (a 20,000-character paper costs milliseconds to map, so 40
/// separate `atlas_find_span` calls spend most of their time re-mapping it). `quotes` is a sequence of frames, each a
/// little-endian u32 byte length followed by that many UTF-8 bytes. The result, in the output buffer, is JSON:
/// `[[start,end],null,...]`, one entry per quote in order. Returns its byte length, or -1 when an input was not valid
/// UTF-8 or the frames do not exactly fill `quotes`.
///
/// # Safety
/// Both pointer/length pairs must describe readable memory.
#[no_mangle]
pub unsafe extern "C" fn atlas_find_spans(src: *const u8, src_len: usize, quotes: *const u8, quotes_len: usize) -> i32 {
    let Some(s) = read(src, src_len) else { return -1 };
    let buf: &[u8] = if quotes_len == 0 {
        &[]
    } else {
        std::slice::from_raw_parts(quotes, quotes_len)
    };
    let mut qs: Vec<&str> = Vec::new();
    let mut at = 0;
    while at < buf.len() {
        let Some(head) = buf.get(at..at + 4) else { return -1 };
        let len = u32::from_le_bytes([head[0], head[1], head[2], head[3]]) as usize;
        at += 4;
        let Some(end) = at.checked_add(len) else { return -1 };
        let Some(bytes) = buf.get(at..end) else { return -1 };
        let Ok(q) = std::str::from_utf8(bytes) else { return -1 };
        qs.push(q);
        at = end;
    }
    let items: Vec<String> = find_spans(s, &qs)
        .into_iter()
        .map(|r| match r {
            None => "null".to_string(),
            Some(span) => format!("[{},{}]", span.start, span.end),
        })
        .collect();
    let json = format!("[{}]", items.join(","));
    let l = json.len() as i32;
    set_out(json);
    l
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

/// Drops the output buffer (its block is zeroed on free). The JS loaders call it once they have read a result, so a
/// normalized string or a result is not left behind in memory.
#[no_mangle]
pub extern "C" fn atlas_clear_out() {
    OUT.with(|o| *o.borrow_mut() = Vec::new());
}

/// The Unicode version this build lower-cases with, as major * 1_000_000 + minor * 1_000 + update. The JS side
/// compares it with the engine's own version, because case mapping only agrees when the two are equal.
#[no_mangle]
pub extern "C" fn atlas_unicode_version() -> u32 {
    let (major, minor, update) = char::UNICODE_VERSION;
    u32::from(major) * 1_000_000 + u32::from(minor) * 1_000 + u32::from(update)
}
