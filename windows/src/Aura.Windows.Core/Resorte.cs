namespace Aura.Windows.Core;

/// <summary>
/// Un resorte crítico-amortiguado a gusto (como las animaciones del notch de Apple): se le cambia el
/// objetivo en cualquier momento y sigue desde donde está, con su velocidad, sin saltos.
/// </summary>
public sealed class Resorte
{
    public double Valor { get; private set; }
    public double Velocidad { get; private set; }
    public double Objetivo { get; set; }
    public double Rigidez { get; set; }
    public double Amortiguacion { get; set; }

    public Resorte(double inicial, double rigidez = 320, double amortiguacion = 28)
    {
        Valor = Objetivo = inicial;
        Rigidez = rigidez;
        Amortiguacion = amortiguacion;
    }

    public bool Quieto => Math.Abs(Valor - Objetivo) < 0.05 && Math.Abs(Velocidad) < 0.05;

    /// <summary>Avanza `dt` segundos (en pasos de 4 ms para que no explote con un fotograma lento).</summary>
    public double Paso(double dt)
    {
        dt = Math.Clamp(dt, 0, 0.1);
        while (dt > 0)
        {
            var h = Math.Min(dt, 0.004);
            var a = Rigidez * (Objetivo - Valor) - Amortiguacion * Velocidad;
            Velocidad += a * h;
            Valor += Velocidad * h;
            dt -= h;
        }
        if (Quieto) { Valor = Objetivo; Velocidad = 0; }
        return Valor;
    }

    public void Saltar(double v) { Valor = Objetivo = v; Velocidad = 0; }
}
