using System;
using System.Collections.Generic;
using System.IO;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace Aura.Windows.Centro;

/// <summary>
/// Un cajón pequeño cifrado con DPAPI (solo esta cuenta de Windows lo abre) para lo que guarda la página
/// del Centro: las llaves de este aparato en PULSE2CHAT y su cuenta del chat. La página nunca toca el disco.
/// </summary>
internal static class Secretos
{
    static readonly Regex ClaveValida = new("^[a-z0-9._-]{1,60}$");
    static readonly object candado = new();
    static string Archivo => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "AuraWindows", "secretos.bin");

    static Dictionary<string, string> Leer()
    {
        try
        {
            if (!File.Exists(Archivo)) return new();
            var b = ProtectedData.Unprotect(File.ReadAllBytes(Archivo), null, DataProtectionScope.CurrentUser);
            return JsonSerializer.Deserialize<Dictionary<string, string>>(b) ?? new();
        }
        catch { return new(); }
    }

    static void Escribir(Dictionary<string, string> d)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(Archivo)!);
        var tmp = Archivo + ".tmp";
        File.WriteAllBytes(tmp, ProtectedData.Protect(JsonSerializer.SerializeToUtf8Bytes(d), null, DataProtectionScope.CurrentUser));
        File.Move(tmp, Archivo, true);
    }

    static void Validar(string clave)
    {
        if (!ClaveValida.IsMatch(clave)) throw new InvalidOperationException("Nombre de secreto inválido.");
    }

    public static string? Obtener(string clave) { Validar(clave); lock (candado) return Leer().TryGetValue(clave, out var v) ? v : null; }

    public static void Guardar(string clave, string valor)
    {
        Validar(clave);
        if (valor.Length > 16_384) throw new InvalidOperationException("El secreto es demasiado grande.");
        lock (candado) { var d = Leer(); d[clave] = valor; if (d.Count > 200) throw new InvalidOperationException("Demasiados secretos."); Escribir(d); }
    }

    public static void Borrar(string clave) { Validar(clave); lock (candado) { var d = Leer(); if (d.Remove(clave)) Escribir(d); } }

    /// <summary>Al salir de la cuenta: se borra todo (las llaves del chat eran de esa persona).</summary>
    public static void BorrarTodo() { lock (candado) { try { File.Delete(Archivo); } catch { } } }
}
