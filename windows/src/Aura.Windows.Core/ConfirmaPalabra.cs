namespace Aura.Windows.Core;

/// <summary>
/// CUÁNDO CUENTA «OYE AURA». José (1-oct): «baja el umbral». Con 0,9 solo pasaba el 67 % de los «oye aura» en
/// español. Ahora basta 0,75, pero sostenido: dos trozos seguidos (80 ms cada uno) por encima, como hace una
/// palabra de verdad, y no el pico suelto de un ruido o de la tele. Un trozo de 0,9 o más despierta solo, como antes.
/// </summary>
public sealed class ConfirmaPalabra
{
    public const float Umbral = 0.75f;
    public const float Seguro = 0.9f;
    float anterior;

    /// <summary>El puntaje de un trozo del modelo; true si con este ya cuenta como «oye aura».</summary>
    public bool Alimentar(float p)
    {
        bool cuenta = p >= Seguro || (p >= Umbral && anterior >= Umbral);
        anterior = p;
        return cuenta;
    }

    public void Reiniciar() => anterior = 0;
}
