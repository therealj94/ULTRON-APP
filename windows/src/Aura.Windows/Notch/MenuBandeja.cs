using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using Aura.Windows.Marca;
using Dibujo = System.Drawing;
using Forms = System.Windows.Forms;

namespace Aura.Windows.Notch;

/// <summary>
/// El menú de la bandeja con «Contraste»: grafito, filo de 1 px, Plex Sans para el texto y Plex Mono para los atajos,
/// la fila elegida con su filo de oro a la izquierda (de lacre en «Cerrar AURA»). Arriba, la marca y «AU·RA FP».
/// Las fuentes Plex se cargan desde el .exe en GDI (AddFontMemResourceEx) para que el menú de Windows las pueda usar.
/// </summary>
internal static class MenuBandeja
{
    [DllImport("gdi32.dll")] static extern IntPtr AddFontMemResourceEx(IntPtr fuente, uint largo, IntPtr reservado, ref uint cuantas);

    static readonly Dibujo.Text.PrivateFontCollection Coleccion = new();
    static bool cargadas;

    internal static readonly Dibujo.Color Grafito = Dibujo.Color.FromArgb(0x17, 0x15, 0x12), Grafito2 = Dibujo.Color.FromArgb(0x22, 0x1F, 0x1A),
        Linea = Dibujo.Color.FromArgb(0x2E, 0x2A, 0x23), Papel = Dibujo.Color.FromArgb(0xEC, 0xE5, 0xD6), Ceniza = Dibujo.Color.FromArgb(0x8E, 0x87, 0x7A),
        OroCrudo = Dibujo.Color.FromArgb(0xB8, 0x91, 0x3F), Lacre = Dibujo.Color.FromArgb(0xB5, 0x48, 0x2E);

    static void CargarFuentes()
    {
        if (cargadas) return;
        cargadas = true;
        foreach (var archivo in new[] { "IBMPlexSans-Regular.ttf", "IBMPlexMono-Regular.ttf", "IBMPlexSansCondensed-SemiBold.ttf" })
        {
            try
            {
                var info = Application.GetResourceStream(new Uri("pack://application:,,,/Aura.Windows;component/Fuentes/" + archivo));
                if (info == null) continue;
                using var s = info.Stream;
                using var m = new MemoryStream(); s.CopyTo(m);
                var bytes = m.ToArray();
                // La memoria queda reservada mientras viva AURA: GDI+ y GDI la leen cada vez que dibujan.
                var p = Marshal.AllocCoTaskMem(bytes.Length);
                Marshal.Copy(bytes, 0, p, bytes.Length);
                Coleccion.AddMemoryFont(p, bytes.Length);
                uint cuantas = 0;
                AddFontMemResourceEx(p, (uint)bytes.Length, IntPtr.Zero, ref cuantas);
            }
            catch { /* sin la fuente, Segoe UI */ }
        }
    }

    /// <summary>Una fuente Plex por su nombre de familia de Windows («IBM Plex Sans», «IBM Plex Mono», «IBM Plex Sans Cond SmBld»).</summary>
    static Dibujo.Font Fuente(string familia, float puntos)
    {
        CargarFuentes();
        foreach (var f in Coleccion.Families)
            if (string.Equals(f.Name, familia, StringComparison.OrdinalIgnoreCase)) return new Dibujo.Font(f, puntos, Dibujo.FontStyle.Regular);
        return new Dibujo.Font("Segoe UI", puntos);
    }

    internal static Dibujo.Font Texto => texto ??= Fuente("IBM Plex Sans", 9f);
    internal static Dibujo.Font Atajo => atajo ??= Fuente("IBM Plex Mono", 8.25f);
    internal static Dibujo.Font LetraCabecera => rotulo ??= Fuente("IBM Plex Sans Cond SmBld", 9f);
    static Dibujo.Font? texto, atajo, rotulo;

    /// <summary>Viste el menú: renderer, letras y la cabecera con la marca.</summary>
    public static void Vestir(Forms.ContextMenuStrip menu)
    {
        menu.Renderer = new Pintor();
        menu.Font = Texto;
        menu.BackColor = Grafito; menu.ForeColor = Papel;
        menu.Padding = new Forms.Padding(0, 4, 0, 4);
        var cabecera = new Forms.ToolStripLabel("AU·RA  FP") { Font = LetraCabecera, ForeColor = Papel, Image = Marca(32), ImageScaling = Forms.ToolStripItemImageScaling.SizeToFit, Margin = new Forms.Padding(0, 2, 0, 4), Tag = "cabecera" };
        menu.Items.Insert(0, cabecera);
        menu.Items.Insert(1, new Forms.ToolStripSeparator());
    }

    /// <summary>marca-chica.svg (≤ 32 px): el punzón de oro con «AU» un poco más grande, para que se lea chico.</summary>
    static Dibujo.Bitmap? Marca(int lado)
    {
        try
        {
            var v = new DrawingVisual();
            using (var dc = v.RenderOpen())
            {
                double k = lado / 512.0;
                dc.PushTransform(new ScaleTransform(k, k));
                dc.DrawGeometry(Contraste.OroMarca, null, Contraste.Punzon);
                dc.PushTransform(new ScaleTransform(1.06, 1.06, 256, 256));
                dc.DrawGeometry(Contraste.Pincel(Color.FromRgb(0x12, 0x0E, 0x08)), null, Contraste.Letras);
                dc.Pop(); dc.Pop();
            }
            var rtb = new RenderTargetBitmap(lado, lado, 96, 96, PixelFormats.Pbgra32);
            rtb.Render(v);
            var enc = new PngBitmapEncoder(); enc.Frames.Add(BitmapFrame.Create(rtb));
            var m = new MemoryStream(); enc.Save(m); m.Position = 0;
            return new Dibujo.Bitmap(m);
        }
        catch { return null; }
    }

    sealed class Tabla : Forms.ProfessionalColorTable
    {
        public override Dibujo.Color ToolStripDropDownBackground => Grafito;
        public override Dibujo.Color ImageMarginGradientBegin => Grafito;
        public override Dibujo.Color ImageMarginGradientMiddle => Grafito;
        public override Dibujo.Color ImageMarginGradientEnd => Grafito;
        public override Dibujo.Color MenuBorder => Linea;
        public override Dibujo.Color MenuItemBorder => Dibujo.Color.Transparent;
        public override Dibujo.Color MenuItemSelected => Grafito2;
        public override Dibujo.Color SeparatorDark => Linea;
        public override Dibujo.Color SeparatorLight => Grafito;
    }

    sealed class Pintor : Forms.ToolStripProfessionalRenderer
    {
        public Pintor() : base(new Tabla()) { RoundedEdges = false; }

        protected override void OnRenderToolStripBackground(Forms.ToolStripRenderEventArgs e)
        {
            using var b = new Dibujo.SolidBrush(Grafito);
            e.Graphics.FillRectangle(b, e.AffectedBounds);
        }

        protected override void OnRenderToolStripBorder(Forms.ToolStripRenderEventArgs e)
        {
            using var p = new Dibujo.Pen(Linea);
            var r = e.AffectedBounds; r.Width -= 1; r.Height -= 1;
            e.Graphics.DrawRectangle(p, r);
        }

        protected override void OnRenderImageMargin(Forms.ToolStripRenderEventArgs e)
        {
            using var b = new Dibujo.SolidBrush(Grafito);
            e.Graphics.FillRectangle(b, e.AffectedBounds);
        }

        protected override void OnRenderMenuItemBackground(Forms.ToolStripItemRenderEventArgs e)
        {
            if (!e.Item.Selected || !e.Item.Enabled) return;
            var r = new Dibujo.Rectangle(4, 1, e.Item.Width - 8, e.Item.Height - 2);
            using (var b = new Dibujo.SolidBrush(Grafito2)) e.Graphics.FillRectangle(b, r);
            // El filo de la fila elegida: oro (lacre en lo que cierra AURA).
            using var p = new Dibujo.Pen(Equals(e.Item.Tag, "peligro") ? Lacre : OroCrudo);
            e.Graphics.DrawLine(p, r.Left, r.Top + 3, r.Left, r.Bottom - 4);
        }

        protected override void OnRenderItemText(Forms.ToolStripItemTextRenderEventArgs e)
        {
            bool atajo = e.Item is Forms.ToolStripMenuItem mi && !string.IsNullOrEmpty(mi.ShortcutKeyDisplayString) && e.Text == mi.ShortcutKeyDisplayString;
            e.TextColor = atajo ? Ceniza : Papel;
            if (atajo) e.TextFont = Atajo;
            base.OnRenderItemText(e);
        }

        protected override void OnRenderSeparator(Forms.ToolStripSeparatorRenderEventArgs e)
        {
            using var p = new Dibujo.Pen(Linea);
            int y = e.Item.Height / 2;
            e.Graphics.DrawLine(p, 10, y, e.Item.Width - 10, y);
        }

        protected override void OnRenderLabelBackground(Forms.ToolStripItemRenderEventArgs e) { }
    }
}
