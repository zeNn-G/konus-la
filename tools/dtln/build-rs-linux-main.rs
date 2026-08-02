
#[cfg(target_os = "linux")]
fn main() {
    use std::{env, process::Command};

    Command::new("tar")
        .arg("-xjf")
        .arg("./tflite/tflite-prebuilt.wasm.tar.bz2")
        .arg("-C")
        .arg("./tflite/")
        .status()
        .unwrap();

    let root_dir = env::var("CARGO_MANIFEST_DIR").unwrap();
    println!("cargo:rustc-link-search=native={}/tflite/lib/", root_dir);

    std::fs::read_dir(std::format!("{}/tflite/lib", root_dir))
        .unwrap()
        .for_each(|entry| {
            let path = entry.unwrap().path();
            match path.extension() {
                Some(ext) if ext == "a" => {
                    let lib_name = path.file_stem().unwrap().to_str().unwrap();
                    if let Some(lib_name) = lib_name.strip_prefix("lib") {
                        println!("cargo:rustc-link-lib=dylib={}", lib_name);
                    }
                }
                _ => {}
            };
        });
}
