//! 离线验证：B 站 m4s（fragmented MP4 + AAC-LC）能被 symphonia 直接解复用/解码。
//! 用法：cargo run --example bili_decode -- <path-to-m4s>
use symphonia::core::audio::SampleBuffer;
use symphonia::core::codecs::{DecoderOptions, CODEC_TYPE_NULL};
use symphonia::core::formats::FormatOptions;
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let path = std::env::args().nth(1).expect("用法: bili_decode <file>");
    let src = std::fs::File::open(&path)?;
    let mss = MediaSourceStream::new(Box::new(src), Default::default());
    let mut hint = Hint::new();
    hint.with_extension("m4s");
    let probed = symphonia::default::get_probe().format(
        &hint,
        mss,
        &FormatOptions::default(),
        &MetadataOptions::default(),
    )?;
    let mut format = probed.format;
    let track = format
        .tracks()
        .iter()
        .find(|t| t.codec_params.codec != CODEC_TYPE_NULL)
        .ok_or("没有可解码的轨道")?;
    let track_id = track.id;
    println!(
        "probe ok: codec={:?} sr={:?} ch={:?} frames={:?}",
        track.codec_params.codec,
        track.codec_params.sample_rate,
        track.codec_params.channels,
        track.codec_params.n_frames,
    );
    let mut decoder =
        symphonia::default::get_codecs().make(&track.codec_params, &DecoderOptions::default())?;
    let mut total = 0u64;
    let mut nonzero = 0u64;
    let mut packets = 0u64;
    let mut peak: f32 = 0.0;
    loop {
        let packet = match format.next_packet() {
            Ok(p) => p,
            Err(e) => {
                println!("packet end: {e}");
                break;
            }
        };
        if packet.track_id() != track_id {
            continue;
        }
        match decoder.decode(&packet) {
            Ok(decoded) => {
                packets += 1;
                let spec = *decoded.spec();
                let mut sbuf = SampleBuffer::<f32>::new(decoded.capacity() as u64, spec);
                sbuf.copy_interleaved_ref(decoded);
                for s in sbuf.samples() {
                    let a = s.abs();
                    if a > peak {
                        peak = a;
                    }
                    if a > 1e-4 {
                        nonzero += 1;
                    }
                    total += 1;
                }
                if total >= 8_000_000 {
                    break;
                }
            }
            Err(e) => {
                eprintln!("decode err: {e}");
                break;
            }
        }
    }
    println!("packets={packets} samples={total} nonzero={nonzero} peak={peak:.3}");
    if nonzero == 0 {
        return Err("解码出的样本全为零：解复用/解码失败".into());
    }
    if peak < 0.01 {
        return Err("峰值过低，疑似静音轨".into());
    }
    println!("OK: fMP4/AAC 解码正常，音频数据有效");
    Ok(())
}
