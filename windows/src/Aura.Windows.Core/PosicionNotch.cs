namespace Aura.Windows.Core;

/// <summary>A qué borde del monitor va pegado el notch. Nunca flota en medio de la pantalla.</summary>
public enum BordeNotch { Arriba, Abajo }

/// <summary>Dónde vive el notch: el borde y qué tan a la izquierda (0) o a la derecha (1) va.</summary>
public readonly record struct LugarNotch(BordeNotch Borde, double Fraccion)
{
    public static readonly LugarNotch DeFabrica = new(BordeNotch.Arriba, 0.5);
    /// <summary>Arriba al centro: el único lugar donde se dibuja la «cámara» (imita el notch de la cámara).</summary>
    public bool EsDeFabrica => Borde == BordeNotch.Arriba && Math.Abs(Fraccion - 0.5) < 1e-6;
}

/// <summary>
/// Las cuentas de mover el notch por los bordes, sin ventanas (se prueban en windows/tests). Todo va en la
/// misma unidad (píxeles del monitor o DIP, da igual): el monitor es [izq, der] en horizontal y [arriba, abajo]
/// en vertical; la ventana mide <c>anchoVentana</c>; la píldora en reposo mide <c>anchoReposo</c> más sus
/// dos orejas; <c>margen</c> es lo que se separa del canto del monitor.
/// </summary>
public static class PosicionNotch
{
    /// <summary>Qué tan cerca (en la misma unidad) tiene que quedar de izquierda, centro o derecha para pegarse ahí.</summary>
    public const double ImanPorDefecto = 56;

    /// <summary>El recorrido del centro de la píldora: de lo más a la izquierda a lo más a la derecha.</summary>
    static (double Min, double Max) Recorrido(double izq, double der, double anchoReposo, double oreja, double margen)
    {
        double min = izq + margen + oreja + anchoReposo / 2, max = der - margen - oreja - anchoReposo / 2;
        if (max < min) { var c = (izq + der) / 2; return (c, c); }
        return (min, max);
    }

    /// <summary>El borde más cercano al punto: la mitad de arriba del monitor es «arriba»; la de abajo, «abajo».</summary>
    public static BordeNotch BordeMasCercano(double y, double arriba, double abajo) => y < (arriba + abajo) / 2 ? BordeNotch.Arriba : BordeNotch.Abajo;

    /// <summary>
    /// De un centro de píldora deseado (el cursor al arrastrar) a la fracción 0..1, con imán: cerca de la
    /// izquierda, del centro o de la derecha se queda exactamente ahí.
    /// </summary>
    public static double Fraccion(double centro, double izq, double der, double anchoReposo, double oreja, double margen, double iman = ImanPorDefecto)
    {
        var (min, max) = Recorrido(izq, der, anchoReposo, oreja, margen);
        double rango = max - min;
        if (rango <= 0 || !double.IsFinite(centro)) return 0.5;
        double c = Math.Clamp(centro, min, max);
        if (Math.Abs(c - (min + max) / 2) <= iman) return 0.5;
        if (c - min <= iman) return 0;
        if (max - c <= iman) return 1;
        return Math.Clamp((c - min) / rango, 0, 1);
    }

    /// <summary>El centro de la píldora en reposo para una fracción.</summary>
    public static double CentroReposo(double fraccion, double izq, double der, double anchoReposo, double oreja, double margen)
    {
        var (min, max) = Recorrido(izq, der, anchoReposo, oreja, margen);
        return min + Math.Clamp(double.IsFinite(fraccion) ? fraccion : 0.5, 0, 1) * (max - min);
    }

    /// <summary>
    /// El borde izquierdo de la ventana: centrada sobre la píldora, pero siempre entera dentro del monitor
    /// (así nunca asoma en el monitor de al lado).
    /// </summary>
    public static double IzquierdaVentana(double centro, double izq, double der, double anchoVentana)
    {
        if (der - izq <= anchoVentana) return izq;
        return Math.Clamp(centro - anchoVentana / 2, izq, der - anchoVentana);
    }

    /// <summary>
    /// El centro de la píldora cuando crece (panel, música, aviso): sigue en su sitio, pero si se saldría por
    /// un lado se corre hacia dentro hasta quedar entera en el monitor.
    /// </summary>
    public static double CentroVisible(double centroReposo, double ancho, double izq, double der, double oreja, double margen)
    {
        double min = izq + margen + oreja + ancho / 2, max = der - margen - oreja - ancho / 2;
        if (max < min) return (izq + der) / 2;
        return Math.Clamp(centroReposo, min, max);
    }

    /// <summary>
    /// La parte de arriba de la ventana: arriba, pegada al borde del monitor; abajo, apoyada en el borde de
    /// abajo (el del área de trabajo, encima de la barra de tareas) y creciendo hacia arriba.
    /// </summary>
    public static double ArribaVentana(BordeNotch borde, double alto, double arribaMonitor, double abajoTrabajo)
        => borde == BordeNotch.Arriba ? arribaMonitor : abajoTrabajo - alto;

    /// <summary>Lee el borde guardado («arriba» / «abajo»); cualquier otra cosa es «arriba».</summary>
    public static BordeNotch LeerBorde(string? s) => s == "abajo" ? BordeNotch.Abajo : BordeNotch.Arriba;
    public static string Nombre(BordeNotch b) => b == BordeNotch.Abajo ? "abajo" : "arriba";

    /// <summary>Una fracción guardada válida (si viene rota o fuera de rango, el centro).</summary>
    public static double LeerFraccion(double f) => double.IsFinite(f) ? Math.Clamp(f, 0, 1) : 0.5;
}

/// <summary>Qué está mostrando el notch, para decidir cuánto vidrio deja ver.</summary>
public enum CapaVidrio { Reposo, ReposoConRaton, Escucha, Musica, Lectura, Confirmar, Panel }

/// <summary>
/// El vidrio del notch: la píldora (reposo, escucha, música) usa el valor del usuario; lo que se lee
/// (habla, avisos, confirmar, el panel) nunca baja de <see cref="MinimoConTexto"/>, para que el texto se lea
/// sobre cualquier fondo.
/// </summary>
public static class VidrioNotch
{
    /// <summary>0.30 deja ver mucho el fondo; 1 es el negro sólido de siempre. 0.5 por defecto.</summary>
    public const double Min = 0.30, Max = 1, PorDefecto = 0.5, MinimoConTexto = 0.9;

    /// <summary>El ajuste guardado, válido (roto o fuera de rango → dentro de los límites).</summary>
    public static double Leer(double t) => double.IsFinite(t) ? Math.Clamp(t, Min, Max) : PorDefecto;

    /// <summary>Cuánto tapa (0..1) cada capa con el ajuste <paramref name="t"/>.</summary>
    public static double Opacidad(double t, CapaVidrio capa)
    {
        t = Leer(t);
        return capa switch
        {
            CapaVidrio.Reposo => t,
            // Con el ratón encima salen su nombre y los botones: un poco más opaco para leerlos.
            CapaVidrio.ReposoConRaton => Math.Max(t, 0.75),
            CapaVidrio.Escucha => t + (1 - t) * 0.2,
            CapaVidrio.Musica => t + (1 - t) * 0.3,
            CapaVidrio.Lectura => Math.Max(t, MinimoConTexto),
            CapaVidrio.Confirmar => Math.Max(t, 0.93),
            CapaVidrio.Panel => Math.Max(t, 0.95),
            _ => t,
        };
    }
}
