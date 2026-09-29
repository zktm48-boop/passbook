# 네이비 배경 + 황동색 원형 도장 + '통' 글자 아이콘 생성 (Windows PowerShell 5.1)
Add-Type -AssemblyName System.Drawing
$root = Split-Path -Parent $PSScriptRoot
$out = Join-Path $root 'icons'
New-Item -ItemType Directory -Force $out | Out-Null
$glyph = [string][char]0xD1B5  # '통' (파일 인코딩 문제를 피하려고 코드포인트로)

function Make-Icon([int]$size, [string]$name) {
  $bmp = New-Object System.Drawing.Bitmap $size, $size
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
  $g.Clear([System.Drawing.ColorTranslator]::FromHtml('#152A3B'))
  $brass = [System.Drawing.ColorTranslator]::FromHtml('#D8B47B')
  $pen = New-Object System.Drawing.Pen $brass, ([float]($size * 0.035))
  $m = [float]($size * 0.2)
  $g.DrawEllipse($pen, $m, $m, [float]($size - 2 * $m), [float]($size - 2 * $m))
  $font = New-Object System.Drawing.Font 'Malgun Gothic', ([float]($size * 0.3)), ([System.Drawing.FontStyle]::Bold), ([System.Drawing.GraphicsUnit]::Pixel)
  $sf = New-Object System.Drawing.StringFormat
  $sf.Alignment = [System.Drawing.StringAlignment]::Center
  $sf.LineAlignment = [System.Drawing.StringAlignment]::Center
  $brush = New-Object System.Drawing.SolidBrush $brass
  $g.DrawString($glyph, $font, $brush, (New-Object System.Drawing.RectangleF 0, 0, $size, $size), $sf)
  $bmp.Save((Join-Path $out $name), [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose()
}

Make-Icon 192 'icon-192.png'
Make-Icon 512 'icon-512.png'
Make-Icon 180 'apple-touch-icon.png'
Write-Output "icons done: $out"
