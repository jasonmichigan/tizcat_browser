# Photographs one TizCat window (and its popups, such as an extension's
# toolbar popup) by window handle, so nothing else on the screen gets in.
# Usage: capture.ps1 -ProcessId <browser pid> -Out <png>
param([int]$ProcessId, [string]$Out)

Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class Shot {
  public delegate bool EnumProc(IntPtr h, IntPtr p);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc f, IntPtr p);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr hdc, uint flags);
  [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr h, int a, out RECT r, int size);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  public static List<IntPtr> Windows(uint want) {
    var list = new List<IntPtr>();
    EnumWindows((h, p) => {
      uint pid; GetWindowThreadProcessId(h, out pid);
      if (pid == want && IsWindowVisible(h) && !IsIconic(h)) list.Add(h);
      return true;
    }, IntPtr.Zero);
    return list;
  }
  public static RECT Visible(IntPtr h) {
    RECT r;
    if (DwmGetWindowAttribute(h, 9, out r, Marshal.SizeOf(typeof(RECT))) != 0) GetWindowRect(h, out r);
    return r;
  }
}
"@

$windows = [Shot]::Windows([uint32]$ProcessId)
# The main window is the largest; the others are drawn over it where they sit.
$sized = foreach ($h in $windows) {
  $r = [Shot]::Visible($h)
  [pscustomobject]@{ H = $h; R = $r; Area = ($r.Right - $r.Left) * ($r.Bottom - $r.Top) }
}
$main = $sized | Sort-Object Area -Descending | Select-Object -First 1
if (-not $main) { throw "no window for process $ProcessId" }
$m = $main.R
$w = $m.Right - $m.Left; $hgt = $m.Bottom - $m.Top
$canvas = New-Object System.Drawing.Bitmap $w, $hgt
$g = [System.Drawing.Graphics]::FromImage($canvas)

# EnumWindows lists the top window first, so draw from the bottom up.
$order = @($sized)
[array]::Reverse($order)
foreach ($win in $order) {
  $r = $win.R
  if ($win.H -ne $main.H) {
    # Only popups that sit over the main window.
    if ($r.Right -le $m.Left -or $r.Left -ge $m.Right -or $r.Bottom -le $m.Top -or $r.Top -ge $m.Bottom) { continue }
  }
  $full = New-Object Shot+RECT
  [void][Shot]::GetWindowRect($win.H, [ref]$full)
  $fw = $full.Right - $full.Left; $fh = $full.Bottom - $full.Top
  if ($fw -le 0 -or $fh -le 0) { continue }
  $bmp = New-Object System.Drawing.Bitmap $fw, $fh
  $bg = [System.Drawing.Graphics]::FromImage($bmp)
  $hdc = $bg.GetHdc()
  [void][Shot]::PrintWindow($win.H, $hdc, 2)
  $bg.ReleaseHdc($hdc); $bg.Dispose()
  # Crop the invisible resize border, then place it where it is on screen.
  $sx = $r.Left - $full.Left; $sy = $r.Top - $full.Top
  $sw = $r.Right - $r.Left; $sh = $r.Bottom - $r.Top
  $dx = $r.Left - $m.Left; $dy = $r.Top - $m.Top
  if ($win.H -ne $main.H) {
    # A popup's shadow comes out pure black: trim black edges away.
    $blackRow = { param($y) for ($i = 0; $i -lt 40; $i++) { $c = $bmp.GetPixel([int]($sx + ($sw - 1) * $i / 39), $y); if (($c.R + $c.G + $c.B) -gt 12) { return $false } }; return $true }
    $blackCol = { param($x) for ($i = 0; $i -lt 40; $i++) { $c = $bmp.GetPixel($x, [int]($sy + ($sh - 1) * $i / 39)); if (($c.R + $c.G + $c.B) -gt 12) { return $false } }; return $true }
    $t = 0; while ($t -lt 40 -and (& $blackRow ($sy + $t))) { $t++ }
    $b = 0; while ($b -lt 40 -and (& $blackRow ($sy + $sh - 1 - $b))) { $b++ }
    $l = 0; while ($l -lt 40 -and (& $blackCol ($sx + $l))) { $l++ }
    $rt = 0; while ($rt -lt 40 -and (& $blackCol ($sx + $sw - 1 - $rt))) { $rt++ }
    $sx += $l; $dx += $l; $sy += $t; $dy += $t
    $sw -= ($l + $rt); $sh -= ($t + $b)
  }
  $src = New-Object System.Drawing.Rectangle $sx, $sy, $sw, $sh
  $dst = New-Object System.Drawing.Rectangle $dx, $dy, $sw, $sh
  $g.DrawImage($bmp, $dst, $src, [System.Drawing.GraphicsUnit]::Pixel)
  $bmp.Dispose()
}
$g.Dispose()
$canvas.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
$canvas.Dispose()
"$w x $hgt, $($sized.Count) window(s)"
