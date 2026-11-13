// Compile for Apple's ARMv7 ABI. qsort enters a nested guest callback.
extern "C" void qsort(void *, unsigned, unsigned, int (*)(const void *, const void *));

struct Outcome { int cleaned, caught; wchar_t message; };
struct Guard {
    Outcome *out;
    ~Guard() { ++out->cleaned; }
};

__attribute__((noinline)) static void fail(const wchar_t *message) { throw message; }

static int compare(const void *left, const void *) {
    Outcome *out = *static_cast<Outcome *const *>(left);
    Guard guard{out};
    fail(&out->message);
    return 0;
}

__attribute__((noinline)) static void run(Outcome *out) {
    Outcome *entries[] = {out, out};
    try { qsort(entries, 2, sizeof(Outcome *), compare); }
    catch (const wchar_t *p) {
        if (p == &out->message) ++out->caught;
        throw;
    }
}

namespace std {
    class exception {
    public:
        virtual ~exception();
        virtual const char *what() const noexcept;
    };
}
extern "C" void vectorLength(void *) asm("__ZNKSt3__120__vector_base_commonILb1EE20__throw_length_errorEv");
extern "C" id objc_getClass(const char *);

static bool vectorError() {
    try { vectorLength(nullptr); }
    catch (const std::exception &error) {
        const char *message = error.what();
        return message[0] == 'v' && message[1] == 'e';
    }
    return false;
}

static bool objcError() {
    id object = objc_getClass("NSObject");
    @try { @throw object; }
    @catch (id error) { return error && error == object; }
}

extern "C" int main() {
    if (!vectorError()) return 3;
    if (!objcError()) return 4;
    Outcome out{0, 0, L'x'};
    try { run(&out); }
    catch (const wchar_t *p) {
        return p == &out.message && out.cleaned == 1 && out.caught == 1 ? 0 : 2;
    }
    return 1;
}
