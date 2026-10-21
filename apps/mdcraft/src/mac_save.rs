//! macOS: the standard Save panel with a "File type:" menu (Markdown file / Markdown template).
//!
//! rfd merges all filters into one list, so the panel is built here: an accessory view with a
//! pop-up button whose action switches the allowed extension, the name's extension and the
//! folder (templates go to the templates folder). The window's own unsafe-free rule is relaxed
//! for this module only: AppKit is Objective-C.
#![allow(unsafe_code)]

use objc2::rc::Retained;
use objc2::runtime::{AnyObject, NSObject};
use objc2::{define_class, msg_send, sel, DefinedClass, MainThreadMarker, MainThreadOnly};
use objc2_app_kit::{NSPopUpButton, NSSavePanel, NSTextField, NSView};
use objc2_foundation::{NSArray, NSPoint, NSRect, NSSize, NSString, NSURL};
use std::path::{Path, PathBuf};

/// One entry of the File type menu.
pub struct FileType {
    pub label: String,
    /// Without the dot: "md", "mdd", "mds".
    pub ext: String,
    /// The folder to switch to when this type is picked (None: stay).
    pub dir: Option<PathBuf>,
}

struct Ivars {
    panel: Retained<NSSavePanel>,
    popup: Retained<NSPopUpButton>,
    types: Vec<(String, Option<PathBuf>)>,
}

define_class!(
    // SAFETY: NSObject has no subclassing requirements; the class doesn't implement Drop.
    #[unsafe(super(NSObject))]
    #[thread_kind = MainThreadOnly]
    #[name = "MdCraftFileTypeTarget"]
    #[ivars = Ivars]
    struct FileTypeTarget;

    impl FileTypeTarget {
        #[unsafe(method(fileTypeChanged:))]
        fn file_type_changed(&self, _sender: Option<&AnyObject>) {
            let iv = self.ivars();
            apply_type(&iv.panel, &iv.types, iv.popup.indexOfSelectedItem(), true);
        }
    }
);

impl FileTypeTarget {
    fn new(mtm: MainThreadMarker, ivars: Ivars) -> Retained<Self> {
        let this = Self::alloc(mtm).set_ivars(ivars);
        // SAFETY: NSObject's designated initializer.
        unsafe { msg_send![super(this), init] }
    }
}

fn url(dir: &Path) -> Retained<NSURL> {
    NSURL::fileURLWithPath(&NSString::from_str(&dir.to_string_lossy()))
}

#[allow(deprecated)] // allowedContentTypes needs UTType objects; the extension list is enough here
fn allow_ext(panel: &NSSavePanel, ext: &str) {
    let list = NSArray::from_retained_slice(&[NSString::from_str(ext)]);
    panel.setAllowedFileTypes(Some(&list));
}

/// Makes the panel save type `index`: its extension in the name field, and its folder.
fn apply_type(panel: &NSSavePanel, types: &[(String, Option<PathBuf>)], index: isize, move_dir: bool) {
    let Some((ext, dir)) = types.get(index.max(0) as usize) else { return };
    allow_ext(panel, ext);
    let name = panel.nameFieldStringValue().to_string();
    let stem = match name.rsplit_once('.') {
        Some((s, e)) if !s.is_empty() && e.len() <= 8 && !e.contains(' ') => s.to_string(),
        _ => name.clone(),
    };
    panel.setNameFieldStringValue(&NSString::from_str(&format!("{stem}.{ext}")));
    // a type with its own folder (templates) is always saved there: say so in the panel
    let note = if dir.is_some() { "Templates are always saved in My templates. Only the name is used." } else { "" };
    panel.setMessage(Some(&NSString::from_str(note)));
    if let (true, Some(d)) = (move_dir, dir) {
        panel.setDirectoryURL(Some(&url(d)));
    }
}

/// Shows the Save panel (app-modal). Returns the chosen path and the index of the file type.
pub fn save_panel(title: &str, name: &str, dir: Option<&Path>, types: &[FileType], selected: usize) -> Option<(PathBuf, usize)> {
    let mtm = MainThreadMarker::new()?;
    let panel = NSSavePanel::savePanel(mtm);
    panel.setTitle(Some(&NSString::from_str(title)));
    panel.setCanCreateDirectories(true);
    panel.setExtensionHidden(false);
    panel.setNameFieldStringValue(&NSString::from_str(name));

    // the accessory view: "File type: [Markdown file (.md)  ⌄]"
    let view = NSView::initWithFrame(NSView::alloc(mtm), NSRect::new(NSPoint::new(0.0, 0.0), NSSize::new(440.0, 46.0)));
    let label = NSTextField::labelWithString(&NSString::from_str("File type:"), mtm);
    label.setFrame(NSRect::new(NSPoint::new(24.0, 14.0), NSSize::new(76.0, 18.0)));
    let popup = NSPopUpButton::initWithFrame_pullsDown(NSPopUpButton::alloc(mtm), NSRect::new(NSPoint::new(102.0, 9.0), NSSize::new(310.0, 26.0)), false);
    for t in types {
        popup.addItemWithTitle(&NSString::from_str(&t.label));
    }
    let selected = selected.min(types.len().saturating_sub(1));
    popup.selectItemAtIndex(selected as isize);
    view.addSubview(&label);
    view.addSubview(&popup);
    panel.setAccessoryView(Some(&view));

    let ivars = Ivars { panel: panel.clone(), popup: popup.clone(), types: types.iter().map(|t| (t.ext.clone(), t.dir.clone())).collect() };
    let target = FileTypeTarget::new(mtm, ivars);
    let target_obj: &AnyObject = &target;
    // SAFETY: the target is a live object that answers fileTypeChanged:, kept alive until the
    // panel is closed (a control does not retain its target).
    unsafe {
        popup.setTarget(Some(target_obj));
        popup.setAction(Some(sel!(fileTypeChanged:)));
    }
    apply_type(&panel, &target.ivars().types, selected as isize, false);
    if let Some(d) = dir {
        panel.setDirectoryURL(Some(&url(d)));
    }

    let response = panel.runModal();
    let chosen = popup.indexOfSelectedItem().max(0) as usize;
    drop(target);
    if response != 1 {
        return None; // NSModalResponseOK = 1
    }
    let path = panel.URL()?.path()?.to_string();
    Some((PathBuf::from(path), chosen))
}
