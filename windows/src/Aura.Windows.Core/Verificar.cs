using System;
using System.Threading;
using System.Threading.Tasks;

namespace Aura.Windows.Core;

/// <summary>
/// HACER Y COMPROBAR. José (1-oct): «a veces dice que hace algo y no lo hace, y hasta la segunda vez lo hace;
/// tiene que probar hasta lograrlo y no decir que sí y no». Abrir un programa o cerrar una ventana es pedirle
/// algo a Windows, que contesta «ok» aunque no pase nada: aquí se espera a VER el resultado (una ventana nueva,
/// la ventana que ya no está) con un tope, y si no se ve, se intenta otra vez. Solo entonces se dice que quedó.
/// </summary>
public static class Verificar
{
    /// <summary>Pregunta <paramref name="listo"/> cada <paramref name="pasoMs"/> hasta que diga que sí o pase el tope.</summary>
    public static async Task<bool> Esperar(Func<bool> listo, int topeMs, int pasoMs = 200, CancellationToken ct = default)
    {
        var fin = Environment.TickCount64 + Math.Max(0, topeMs);
        while (true)
        {
            bool ok;
            try { ok = listo(); } catch { ok = false; }
            if (ok) return true;
            if (Environment.TickCount64 >= fin || ct.IsCancellationRequested) return false;
            try { await Task.Delay(Math.Max(10, pasoMs), ct); } catch (OperationCanceledException) { return false; }
        }
    }

    /// <summary>Intenta hasta <paramref name="veces"/> veces; devuelve en qué intento salió (1, 2…) o 0 si nunca.</summary>
    public static async Task<int> Reintentar(Func<int, Task<bool>> intento, int veces = 2)
    {
        for (int i = 1; i <= Math.Max(1, veces); i++)
        {
            bool ok;
            try { ok = await intento(i); } catch { ok = false; }
            if (ok) return i;
        }
        return 0;
    }
}
