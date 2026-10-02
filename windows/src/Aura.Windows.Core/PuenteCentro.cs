using System;
using System.Collections.Generic;
using System.Text.RegularExpressions;

namespace Aura.Windows.Core;

/// <summary>
/// Las reglas del puente del Centro (WebView2 ↔ AURA), puras y probables: qué origen es el propio, qué
/// métodos existen y qué nombres de secreto puede pedir la página.
/// </summary>
public static class PuenteCentro
{
    /// <summary>El origen de la página del Centro (carpeta CentroAssets servida como host virtual).</summary>
    public static readonly Uri Origen = new("https://centro.aura.local");

    /// <summary>
    /// ¿`url` es EXACTAMENTE del origen `origen`? Esquema, host y puerto iguales, sin usuario ni clave
    /// («https://centro.aura.local@otro» y «https://centro.aura.local.otro» no lo son). Nunca por prefijo.
    /// </summary>
    public static bool OrigenExacto(string? url, Uri origen)
    {
        if (string.IsNullOrEmpty(url) || url.Length > 8192 || !origen.IsAbsoluteUri) return false;
        // Sin espacios ni controles: un URI de verdad no los trae y algunos analizadores los recortan distinto.
        foreach (var c in url) if (char.IsWhiteSpace(c) || char.IsControl(c) || c == '\\') return false;
        if (!Uri.TryCreate(url, UriKind.Absolute, out var u)) return false;
        if (u.UserInfo.Length > 0 || url.Contains('@', StringComparison.Ordinal) && Antes(url, '@') < Antes(url, '/', 8)) return false;
        return string.Equals(u.Scheme, origen.Scheme, StringComparison.OrdinalIgnoreCase)
            && string.Equals(u.IdnHost, origen.IdnHost, StringComparison.OrdinalIgnoreCase)
            && u.Port == origen.Port;
    }

    /// <summary>Posición del primer `c` desde `desde` (o el largo si no está).</summary>
    static int Antes(string s, char c, int desde = 0)
    {
        if (desde >= s.Length) return s.Length;
        int i = s.IndexOf(c, desde);
        return i < 0 ? s.Length : i;
    }

    /// <summary>Todos los métodos que la página puede pedir. Lo demás se rechaza antes de mirar argumentos.</summary>
    public static readonly HashSet<string> Metodos = new(StringComparer.Ordinal)
    {
        "estado", "entrar.genesis", "entrar.enlace", "entrar.clave", "salir", "primeraVez.terminar",
        "ajustes.leer", "ajustes.guardar", "ventana.recoger", "ventana.mostrar", "relevo", "relevo.archivo",
        "secreto.leer", "secreto.guardar", "secreto.borrar",
        "notch.timbre", "notch.colgada", "notch.timbreFin", "notch.aviso", "notch.monitores", "notch.restablecer", "notch.llamada",
        "chat.enviar", "chat.callar", "chat.hablar", "inicio.dia",
        "diagnostico.leer", "diagnostico.carpeta", "actualizar.estado", "actualizar.buscar", "actualizar.instalar",
        "spotify.estado", "spotify.buscar", "spotify.poner", "spotify.control", "spotify.dispositivos", "spotify.transferir",
        "cartera.direccion", "cartera.saldos", "cartera.portapapeles", "cartera.pagar", "cartera.buscarEnvio", "cartera.abrirWallet",
        "conectar", "desconectar",
        // El recorrido del Centro: la voz de Claudio y ANT-ONIO, y AURA sin oír mientras suena.
        "voz.decir", "recorrido.abierto",
    };

    public static bool MetodoPermitido(string? metodo) => metodo != null && Metodos.Contains(metodo);

    /// <summary>
    /// Los secretos que guarda la página son solo los de PULSE2CHAT («p2c.cuenta», «p2c.candado.priv»…):
    /// el cajón no sirve para leer otra cosa aunque alguien lo pida por el puente.
    /// </summary>
    static readonly Regex ClaveSecreto = new(@"^p2c\.[a-z0-9_-]+(?:\.[a-z0-9_-]+)*\z", RegexOptions.CultureInvariant);

    public static bool ClaveSecretoValida(string? clave) => clave is { Length: >= 5 and <= 60 } && ClaveSecreto.IsMatch(clave);
}
