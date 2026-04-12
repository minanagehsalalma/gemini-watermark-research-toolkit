param(
    [string]$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
)

$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Drawing

$testSet = Join-Path $RepoRoot 'TestSet'
$cleanDir = Join-Path $RepoRoot 'outputs\github-comparison-cleaned'
$assetDir = Join-Path $RepoRoot 'docs\assets'
$assetPath = Join-Path $assetDir 'watermark-removal-results.png'

if (-not (Test-Path -LiteralPath $testSet)) {
    throw "Missing required input folder: $testSet"
}

New-Item -ItemType Directory -Force -Path $cleanDir, $assetDir | Out-Null

$samples = Get-ChildItem -LiteralPath $testSet -Filter '*.png' |
    Sort-Object @{ Expression = {
        if ($_.BaseName -match '\((\d+)\)') { [int]$Matches[1] } else { 0 }
    }}, Name |
    Select-Object -First 9

if ($samples.Count -eq 0) {
    throw "No PNG samples found in $testSet"
}

foreach ($sample in $samples) {
    $safeName = ($sample.BaseName -replace '[^\w.-]+', '-').Trim('-')
    $outPath = Join-Path $cleanDir "$safeName-cleaned.png"
    & node (Join-Path $RepoRoot 'remove-gemini-watermark.js') $sample.FullName $outPath | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "Watermark removal failed for $($sample.Name)"
    }
}

$items = foreach ($sample in $samples) {
    $safeName = ($sample.BaseName -replace '[^\w.-]+', '-').Trim('-')
    [pscustomobject]@{
        Label = $sample.BaseName
        Before = $sample.FullName
        After = Join-Path $cleanDir "$safeName-cleaned.png"
    }
}

$width = 1680
$margin = 56
$titleHeight = 146
$footerHeight = 58
$gridGap = 26
$pairGap = 14
$columns = 3
$rows = [Math]::Ceiling($items.Count / $columns)
$pairWidth = [int](($width - ($margin * 2) - ($gridGap * ($columns - 1))) / $columns)
$tileWidth = [int](($pairWidth - $pairGap) / 2)
$tileHeight = $tileWidth
$pairHeaderHeight = 92
$pairHeight = $tileHeight + $pairHeaderHeight + 26
$height = $titleHeight + ($rows * $pairHeight) + (($rows - 1) * $gridGap) + $footerHeight + $margin

$bitmap = [System.Drawing.Bitmap]::new($width, $height, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
$graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
$graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::ClearTypeGridFit

$bg = [System.Drawing.Drawing2D.LinearGradientBrush]::new(
    [System.Drawing.Rectangle]::new(0, 0, $width, $height),
    [System.Drawing.Color]::FromArgb(255, 246, 248, 251),
    [System.Drawing.Color]::FromArgb(255, 226, 235, 245),
    90
)
$graphics.FillRectangle($bg, 0, 0, $width, $height)

$fontTitle = [System.Drawing.Font]::new('Segoe UI Semibold', 42, [System.Drawing.FontStyle]::Bold)
$fontSubtitle = [System.Drawing.Font]::new('Segoe UI', 16, [System.Drawing.FontStyle]::Regular)
$fontColumn = [System.Drawing.Font]::new('Segoe UI Semibold', 11, [System.Drawing.FontStyle]::Bold)
$fontLabel = [System.Drawing.Font]::new('Segoe UI Semibold', 15, [System.Drawing.FontStyle]::Bold)
$fontFooter = [System.Drawing.Font]::new('Segoe UI', 11, [System.Drawing.FontStyle]::Regular)
$brushText = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(255, 15, 23, 42))
$brushMuted = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(255, 71, 85, 105))
$brushGreen = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(255, 22, 101, 52))
$brushRed = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(255, 153, 27, 27))
$brushCard = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(246, 255, 255, 255))
$brushTile = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(255, 241, 245, 249))
$brushRedChip = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(255, 254, 226, 226))
$brushGreenChip = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(255, 220, 252, 231))
$penBorder = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(255, 203, 213, 225), 1)
$penImage = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(255, 148, 163, 184), 1)
$penRedChip = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(255, 252, 165, 165), 1)
$penGreenChip = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(255, 134, 239, 172), 1)

$graphics.DrawString('Gemini watermark removal', $fontTitle, $brushText, $margin, 34)
$graphics.DrawString('Before/after bottom-right crops from the repository test set. Crops preserve aspect ratio and focus on the watermark region.', $fontSubtitle, $brushMuted, $margin + 2, 92)

function Draw-RoundedRect {
    param(
        [System.Drawing.Graphics]$Graphics,
        [System.Drawing.RectangleF]$Rect,
        [float]$Radius,
        [System.Drawing.Brush]$Brush,
        [System.Drawing.Pen]$Pen
    )
    $path = [System.Drawing.Drawing2D.GraphicsPath]::new()
    $diameter = $Radius * 2
    $path.AddArc($Rect.X, $Rect.Y, $diameter, $diameter, 180, 90)
    $path.AddArc($Rect.Right - $diameter, $Rect.Y, $diameter, $diameter, 270, 90)
    $path.AddArc($Rect.Right - $diameter, $Rect.Bottom - $diameter, $diameter, $diameter, 0, 90)
    $path.AddArc($Rect.X, $Rect.Bottom - $diameter, $diameter, $diameter, 90, 90)
    $path.CloseFigure()
    $Graphics.FillPath($Brush, $path)
    if ($null -ne $Pen) {
        $Graphics.DrawPath($Pen, $path)
    }
    $path.Dispose()
}

function Draw-Badge {
    param(
        [System.Drawing.Graphics]$Graphics,
        [int]$X,
        [int]$Y,
        [int]$Width,
        [string]$Text,
        [System.Drawing.Brush]$TextBrush,
        [System.Drawing.Brush]$FillBrush,
        [System.Drawing.Pen]$BorderPen
    )
    $rect = [System.Drawing.RectangleF]::new($X, $Y, $Width, 28)
    Draw-RoundedRect -Graphics $Graphics -Rect $rect -Radius 10 -Brush $FillBrush -Pen $BorderPen
    $format = [System.Drawing.StringFormat]::new()
    $format.Alignment = [System.Drawing.StringAlignment]::Center
    $format.LineAlignment = [System.Drawing.StringAlignment]::Center
    $Graphics.DrawString($Text, $fontColumn, $TextBrush, $rect, $format)
    $format.Dispose()
}

function Draw-AspectCrop {
    param(
        [System.Drawing.Graphics]$Graphics,
        [string]$ImagePath,
        [int]$X,
        [int]$Y,
        [int]$BoxSize
    )

    Draw-RoundedRect -Graphics $Graphics -Rect ([System.Drawing.RectangleF]::new($X, $Y, $BoxSize, $BoxSize)) -Radius 14 -Brush $brushTile -Pen $penImage

    $img = [System.Drawing.Image]::FromFile($ImagePath)
    try {
        $cropSize = [Math]::Min($img.Width, $img.Height)
        $watermarkScale = if ($cropSize -gt 1600) { 0.28 } elseif ($cropSize -gt 900) { 0.34 } else { 0.42 }
        $cropSize = [Math]::Min($cropSize, [Math]::Max(260, [int]([Math]::Min($img.Width, $img.Height) * $watermarkScale)))
        $srcX = [Math]::Max(0, $img.Width - $cropSize)
        $srcY = [Math]::Max(0, $img.Height - $cropSize)
        $src = [System.Drawing.Rectangle]::new($srcX, $srcY, $cropSize, $cropSize)
        $dest = [System.Drawing.Rectangle]::new($X + 10, $Y + 10, $BoxSize - 20, $BoxSize - 20)
        $Graphics.DrawImage($img, $dest, $src, [System.Drawing.GraphicsUnit]::Pixel)
        $Graphics.DrawRectangle($penImage, $dest)
    }
    finally {
        $img.Dispose()
    }
}

$index = 0
foreach ($item in $items) {
    $row = [Math]::Floor($index / $columns)
    $col = $index % $columns
    $x = $margin + ($col * ($pairWidth + $gridGap))
    $y = $titleHeight + ($row * ($pairHeight + $gridGap))

    Draw-RoundedRect -Graphics $graphics -Rect ([System.Drawing.RectangleF]::new($x, $y, $pairWidth, $pairHeight)) -Radius 20 -Brush $brushCard -Pen $penBorder
    $graphics.DrawString(("Sample {0}" -f ($index + 1)), $fontLabel, $brushText, $x + 20, $y + 18)

    $beforeX = $x + 18
    $afterX = $beforeX + $tileWidth + $pairGap
    $badgeY = $y + 50
    $tileY = $y + $pairHeaderHeight

    Draw-Badge -Graphics $graphics -X $beforeX -Y $badgeY -Width $tileWidth -Text 'Original watermark' -TextBrush $brushRed -FillBrush $brushRedChip -BorderPen $penRedChip
    Draw-Badge -Graphics $graphics -X $afterX -Y $badgeY -Width $tileWidth -Text 'Clean output' -TextBrush $brushGreen -FillBrush $brushGreenChip -BorderPen $penGreenChip
    Draw-AspectCrop -Graphics $graphics -ImagePath $item.Before -X $beforeX -Y $tileY -BoxSize $tileWidth
    Draw-AspectCrop -Graphics $graphics -ImagePath $item.After -X $afterX -Y $tileY -BoxSize $tileWidth

    $index += 1
}

$graphics.DrawString('Generated from TestSet/ using remove-gemini-watermark.js.', $fontFooter, $brushMuted, $margin, $height - 48)

$bitmap.Save($assetPath, [System.Drawing.Imaging.ImageFormat]::Png)

$graphics.Dispose()
$bitmap.Dispose()
$bg.Dispose()
$fontTitle.Dispose()
$fontSubtitle.Dispose()
$fontColumn.Dispose()
$fontLabel.Dispose()
$fontFooter.Dispose()
$brushText.Dispose()
$brushMuted.Dispose()
$brushGreen.Dispose()
$brushRed.Dispose()
$brushCard.Dispose()
$brushTile.Dispose()
$brushRedChip.Dispose()
$brushGreenChip.Dispose()
$penBorder.Dispose()
$penImage.Dispose()
$penRedChip.Dispose()
$penGreenChip.Dispose()

Write-Host "Wrote $assetPath"
