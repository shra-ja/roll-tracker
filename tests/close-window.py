"""Send the same X11 close request as a window manager (never kill the app)."""
import ctypes as c
import sys


class ClientMessage(c.Structure):
    _fields_ = [
        ("type", c.c_int), ("serial", c.c_ulong), ("send_event", c.c_int),
        ("display", c.c_void_p), ("window", c.c_ulong),
        ("message_type", c.c_ulong), ("format", c.c_int),
        ("data", c.c_long * 5),
    ]


class Event(c.Union):
    _fields_ = [("client", ClientMessage), ("padding", c.c_long * 24)]


x11 = c.CDLL("libX11.so.6")
x11.XOpenDisplay.argtypes = [c.c_char_p]
x11.XOpenDisplay.restype = c.c_void_p
x11.XInternAtom.argtypes = [c.c_void_p, c.c_char_p, c.c_int]
x11.XInternAtom.restype = c.c_ulong
x11.XSendEvent.argtypes = [c.c_void_p, c.c_ulong, c.c_int, c.c_long, c.POINTER(Event)]
x11.XFlush.argtypes = [c.c_void_p]
x11.XCloseDisplay.argtypes = [c.c_void_p]
display = x11.XOpenDisplay(None)
assert display, "X11 display unavailable"
event = Event()
event.client.type = 33  # ClientMessage
event.client.display = display
event.client.window = int(sys.argv[1])
event.client.message_type = x11.XInternAtom(display, b"WM_PROTOCOLS", 0)
event.client.format = 32
event.client.data[0] = x11.XInternAtom(display, b"WM_DELETE_WINDOW", 0)
assert x11.XSendEvent(display, event.client.window, 0, 0, c.byref(event))
x11.XFlush(display)
x11.XCloseDisplay(display)
