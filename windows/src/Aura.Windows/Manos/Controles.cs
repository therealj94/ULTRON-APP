using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text.RegularExpressions;
using System.Windows.Automation;
using Aura.Windows.Core;

namespace Aura.Windows.Manos;

/// <summary>Un control de la ventana de trabajo que AURA puede pulsar, con cómo se pulsa.</summary>
internal sealed record Control(AutomationElement Elemento, string Nombre, string Tipo, IntPtr Ventana);

/// <summary>
/// Pulsar botones, pestañas, menús y opciones POR SU NOMBRE, con UI Automation: sin mover el ratón ni
/// adivinar por la imagen. Solo en la ventana de trabajo (nunca en AURA), nunca en campos de contraseña
/// y, si el nombre suena a algo con efecto (Enviar, Eliminar, Pagar…), primero pregunta.
/// </summary>
internal static class Controles
{
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("user32.dll")] static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);

    static readonly Regex Delicado = new(@"\b(?:enviar|envia|send|eliminar|elimina|borrar|borra|delete|remove|quitar|pagar|paga|pay|comprar|compra|buy|purchase|order|pedir|publicar|publica|post|tweet|transferir|transfer|instalar|install|desinstalar|uninstall|formatear|format|vaciar|empty|descartar|discard|restablecer|reset|apagar|shut ?down|reiniciar|restart|cerrar sesion|sign out|log ?out|aceptar y|confirmar|confirm|firmar|sign|suscrib|subscribe|reemplazar todo|replace all|no guardar|don t save|sobrescribir|overwrite)\b", RegexOptions.Compiled | RegexOptions.CultureInvariant);

    public static bool EsDelicado(string nombre) => Delicado.IsMatch(LayaLigera.Normalizar(nombre));

    static readonly ControlType[] Pulsables = { ControlType.Button, ControlType.TabItem, ControlType.MenuItem, ControlType.Hyperlink, ControlType.ListItem,
        ControlType.CheckBox, ControlType.RadioButton, ControlType.SplitButton, ControlType.TreeItem, ControlType.DataItem, ControlType.ComboBox };

    static string TipoHumano(ControlType t, bool en) =>
        t == ControlType.TabItem ? (en ? "tab" : "pestaña") : t == ControlType.MenuItem ? "menú" : t == ControlType.Hyperlink ? (en ? "link" : "enlace")
        : t == ControlType.CheckBox ? (en ? "checkbox" : "casilla") : t == ControlType.ListItem || t == ControlType.TreeItem || t == ControlType.DataItem ? (en ? "item" : "elemento")
        : en ? "button" : "botón";

    /// <summary>Los controles con nombre visibles de la ventana (tope de nodos y tiempo).</summary>
    public static List<Control> Visibles(IntPtr ventana, bool ingles, int maxNodos = 3000, int maxMs = 1500)
    {
        var lista = new List<Control>();
        var reloj = Stopwatch.StartNew();
        var cola = new Queue<AutomationElement>();
        try { cola.Enqueue(AutomationElement.FromHandle(ventana)); } catch { return lista; }
        var walker = TreeWalker.ControlViewWalker;
        int nodos = 0;
        while (cola.Count > 0 && nodos < maxNodos && reloj.ElapsedMilliseconds < maxMs)
        {
            var e = cola.Dequeue(); nodos++;
            try
            {
                var c = e.Current;
                if (!c.IsOffscreen && c.IsEnabled && !c.IsPassword && Pulsables.Contains(c.ControlType) && !string.IsNullOrWhiteSpace(c.Name) && c.Name.Length <= 80)
                    lista.Add(new Control(e, c.Name.Trim(), TipoHumano(c.ControlType, ingles), ventana));
                if (c.ControlType == ControlType.Document) continue;
                for (var h = walker.GetFirstChild(e); h != null; h = walker.GetNextSibling(h)) cola.Enqueue(h);
            }
            catch (ElementNotAvailableException) { }
            catch (InvalidOperationException) { }
        }
        return lista;
    }

    /// <summary>El control cuyo nombre mejor calza con lo dicho, o null. Nunca «el más parecido» si no se parece.</summary>
    public static Control? Buscar(IntPtr ventana, string dicho, bool ingles)
    {
        var q = LayaLigera.Normalizar(dicho);
        if (q.Length == 0) return null;
        Control? mejor = null; int puntos = 0;
        foreach (var c in Visibles(ventana, ingles))
        {
            // «Guardar (Ctrl+G)», «Insertar ▾»: se compara el nombre sin el atajo.
            var n = LayaLigera.Normalizar(Regex.Replace(c.Nombre, @"\(.*?\)|ctrl\+\w+", "", RegexOptions.IgnoreCase));
            int p = n == q ? 100 : n.StartsWith(q + " ", StringComparison.Ordinal) ? 70 : (" " + n + " ").Contains(" " + q + " ", StringComparison.Ordinal) ? 55 : 0;
            if (p > 0 && c.Tipo is "pestaña" or "tab" && q.Length > 2) p += 5;
            if (p > puntos || p == puntos && p > 0 && mejor != null && n.Length < LayaLigera.Normalizar(mejor.Nombre).Length) { puntos = p; mejor = c; }
        }
        return puntos >= 55 ? mejor : null;
    }

    /// <summary>Pulsa el control con el patrón que tenga (Invocar, Seleccionar, Expandir, Alternar). Nada de clics a ciegas.</summary>
    public static void Pulsar(Control c)
    {
        var e = c.Elemento;
        var actual = e.Current;
        if (!actual.IsEnabled || actual.IsPassword) throw new InvalidOperationException("Ese control no está disponible.");
        // La ventana al frente (con Alt: Windows no deja traer ventanas al frente a una app en segundo plano).
        keybd_event(0x12, 0, 0, UIntPtr.Zero); keybd_event(0x12, 0, 2, UIntPtr.Zero);
        SetForegroundWindow(c.Ventana);
        if (e.TryGetCurrentPattern(InvokePattern.Pattern, out var inv)) { ((InvokePattern)inv).Invoke(); return; }
        if (e.TryGetCurrentPattern(SelectionItemPattern.Pattern, out var sel)) { ((SelectionItemPattern)sel).Select(); return; }
        if (e.TryGetCurrentPattern(ExpandCollapsePattern.Pattern, out var exp))
        {
            var ec = (ExpandCollapsePattern)exp;
            if (ec.Current.ExpandCollapseState == ExpandCollapseState.Expanded) ec.Collapse(); else ec.Expand();
            return;
        }
        if (e.TryGetCurrentPattern(TogglePattern.Pattern, out var tog)) { ((TogglePattern)tog).Toggle(); return; }
        throw new InvalidOperationException($"«{c.Nombre}» no se deja pulsar desde fuera. Púlsalo tú, por favor.");
    }
}
