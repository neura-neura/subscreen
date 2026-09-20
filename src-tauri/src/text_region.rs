// Locate bright, outlined subtitle glyphs before sending a wide scene crop to the VLM.
#[cfg(test)]
pub fn locate(rgb: &[u8], w: u32, h: u32) -> Option<(u32, u32, u32, u32)> {
    locate_in_line(rgb, w, h, None)
}

pub fn locate_in_line(
    rgb: &[u8],
    w: u32,
    h: u32,
    line: Option<(u32, u32)>,
) -> Option<(u32, u32, u32, u32)> {
    let (w, h) = (w as usize, h as usize);
    if w < 8 || h < 8 {
        return None;
    }
    let mut mask = vec![false; w * h];
    for y in 2..h - 2 {
        if line.is_some_and(|(top, height)| {
            y < (top + 6) as usize || y >= (top + height.saturating_sub(6)) as usize
        }) {
            continue;
        }
        for x in 2..w - 2 {
            let i = (y * w + x) * 3;
            let p = &rgb[i..i + 3];
            let max = *p.iter().max().unwrap();
            let min = *p.iter().min().unwrap();
            if min < 155 || max - min > 65 {
                continue;
            }
            let dark = [(x - 2, y), (x + 2, y), (x, y - 2), (x, y + 2)]
                .iter()
                .any(|&(nx, ny)| {
                    let n = (ny * w + nx) * 3;
                    rgb[n..n + 3].iter().map(|v| *v as u32).sum::<u32>() / 3 + 60 < min as u32
                });
            mask[y * w + x] = dark;
        }
    }
    // Merge nearby strokes of the same glyph, without filling broad bright scene objects.
    let original = mask.clone();
    for y in 1..h - 1 {
        for x in 1..w - 1 {
            mask[y * w + x] = (-1isize..=1).any(|dy| {
                (-1isize..=1).any(|dx| {
                    original[((y as isize + dy) as usize) * w + (x as isize + dx) as usize]
                })
            });
        }
    }
    let mut boxes = Vec::new();
    for start in 0..mask.len() {
        if !mask[start] {
            continue;
        }
        mask[start] = false;
        let mut stack = vec![start];
        let (mut x0, mut x1, mut y0, mut y1) = (start % w, start % w, start / w, start / w);
        let mut count = 0;
        while let Some(i) = stack.pop() {
            let (x, y) = (i % w, i / w);
            count += 1;
            x0 = x0.min(x);
            x1 = x1.max(x);
            y0 = y0.min(y);
            y1 = y1.max(y);
            for (nx, ny) in [
                (x.saturating_sub(1), y),
                ((x + 1).min(w - 1), y),
                (x, y.saturating_sub(1)),
                (x, (y + 1).min(h - 1)),
            ] {
                let n = ny * w + nx;
                if mask[n] {
                    mask[n] = false;
                    stack.push(n);
                }
            }
        }
        let bw = x1 - x0 + 1;
        let bh = y1 - y0 + 1;
        if bh >= 8 && bh <= h.min(70) && bw >= 2 && (bw <= bh * 3 || line.is_some()) && count >= 12
        {
            boxes.push((x0, y0, x1, y1));
        }
    }
    let mut candidates = Vec::new();
    for b in &boxes {
        let bh = b.3 - b.1 + 1;
        let center = (b.1 + b.3) / 2;
        let mut row: Vec<_> = boxes
            .iter()
            .filter(|c| {
                let ch = c.3 - c.1 + 1;
                center.abs_diff((c.1 + c.3) / 2) <= bh / 3 && ch * 2 >= bh && ch <= bh * 2
            })
            .copied()
            .collect();
        row.sort_by_key(|c| c.0);
        let mut group = Vec::new();
        for c in row {
            if group
                .last()
                .is_some_and(|last: &(usize, usize, usize, usize)| c.0 > last.2 + bh * 2)
            {
                if !group.is_empty() {
                    candidates.push(group.clone());
                }
                group.clear();
            }
            group.push(c);
        }
        if !group.is_empty() {
            candidates.push(group);
        }
    }
    let row = candidates
        .iter()
        .filter(|row| {
            if let Some((line_y, line_height)) = line {
                let left = row.iter().map(|b| b.0).min().unwrap();
                let right = row.iter().map(|b| b.2).max().unwrap();
                if row.len() < 4
                    && !(left < w / 2 && right > w / 2 && right - left > w / 4)
                    && (left + right).abs_diff(w) > w / 12
                {
                    return false;
                }
                let y = row.iter().map(|b| b.1).min().unwrap().saturating_sub(8) as u32;
                let bottom = (row.iter().map(|b| b.3).max().unwrap() + 9).min(h) as u32;
                let tolerance = (line_height / 10).max(3);
                if !((y.abs_diff(line_y) <= tolerance
                    || bottom.abs_diff(line_y + line_height) <= tolerance)
                    && (bottom - y).abs_diff(line_height) <= tolerance * 2)
                {
                    return false;
                }
            }
            if row.len() >= 3 {
                return true;
            }
            let left = row.iter().map(|b| b.0).min().unwrap();
            let right = row.iter().map(|b| b.2).max().unwrap();
            let top = row.iter().map(|b| b.1).min().unwrap();
            let bottom = row.iter().map(|b| b.3).max().unwrap();
            // One- and two-glyph captions are valid; isolated scene highlights at the
            // edges of a broad crop are not sufficient evidence of a text line.
            (left + right).abs_diff(w) < w / 3 && bottom - top >= 12 && top > 2 && bottom + 3 < h
        })
        .max_by(|a, b| {
            let score = |row: &Vec<(usize, usize, usize, usize)>| {
                let left = row.iter().map(|b| b.0).min().unwrap();
                let right = row.iter().map(|b| b.2).max().unwrap();
                (row.len() as f64).sqrt()
                    / (1.0 + ((left + right) as f64 / 2.0 - w as f64 / 2.0).abs() / w as f64 * 20.0)
            };
            score(a).total_cmp(&score(b))
        })?;
    let x0 = row.iter().map(|b| b.0).min()?.saturating_sub(10);
    let x1 = (row.iter().map(|b| b.2).max()? + 11).min(w);
    let y0 = row.iter().map(|b| b.1).min()?.saturating_sub(8);
    let y1 = (row.iter().map(|b| b.3).max()? + 9).min(h);
    Some((x0 as u32, y0 as u32, (x1 - x0) as u32, (y1 - y0) as u32))
}

/// Glyph mask for temporal comparison; ignore scene color and small codec fluctuations.
pub fn signature(rgb: &[u8], w: u32, h: u32, bounds: Option<(u32, u32, u32, u32)>) -> Vec<u8> {
    let mut result = vec![0; (w * h) as usize];
    let Some((x, y, cw, ch)) = bounds else {
        return result;
    };
    for yy in y..y + ch {
        for xx in x..x + cw {
            let i = ((yy * w + xx) * 3) as usize;
            let p = &rgb[i..i + 3];
            let min = *p.iter().min().unwrap();
            let max = *p.iter().max().unwrap();
            let outlined = xx >= 2
                && xx + 2 < w
                && yy >= 2
                && yy + 2 < h
                && [(xx - 2, yy), (xx + 2, yy), (xx, yy - 2), (xx, yy + 2)]
                    .iter()
                    .any(|&(nx, ny)| {
                        let n = ((ny * w + nx) * 3) as usize;
                        rgb[n..n + 3].iter().map(|v| *v as u32).sum::<u32>() / 3 + 60 < min as u32
                    });
            if min >= 155 && max - min <= 65 && outlined {
                result[(yy * w + xx) as usize] = 1;
            }
        }
    }
    result
}

pub fn same_signature(a: &[u8], b: &[u8], width: u32) -> bool {
    if a.len() != b.len() || a.is_empty() {
        return false;
    }
    let mut union = 0;
    let mut changed = 0;
    for (&x, &y) in a.iter().zip(b) {
        if x != 0 || y != 0 {
            union += 1;
            if x != y {
                changed += 1;
            }
        }
    }
    if union == 0 {
        return true;
    }
    if changed * 100 >= union * 8 {
        return false;
    }
    // A single changed character in a long line must not disappear in a global average.
    let width = width as usize;
    let columns = width.div_ceil(16);
    let mut blocks = vec![(0usize, 0usize); columns * (a.len() / width).div_ceil(16)];
    for (i, (&x, &y)) in a.iter().zip(b).enumerate() {
        if x != 0 || y != 0 {
            let block = &mut blocks[(i / width / 16) * columns + (i % width / 16)];
            block.0 += 1;
            if x != y {
                block.1 += 1;
            }
        }
    }
    !blocks
        .iter()
        .any(|&(pixels, delta)| delta >= 16 && delta * 100 >= pixels * 30)
}
