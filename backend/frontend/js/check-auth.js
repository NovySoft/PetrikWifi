async function checkAuth(redirToDash, noRedir = false) {
    let result = await fetch('/me', {
        method: 'POST',
        credentials: 'same-origin',
    });
    if (result.status === 200) {
        result = await result.json();
        console.log(result);
        window.me = result;
        checkBan();
        if (redirToDash) {
            window.location.href = "/dashboard.html";
        }
        return;
    }
    if (noRedir) return;
    window.location.href = '/';
}

function checkAdmin() {
    if (window.me?.isAdmin === true) return;
    Swal.fire({
        icon: 'error',
        title: 'Csak adminoknak!',
        showCancelButton: false,
        confirmButtonText: 'OK',
    }).then((result) => {
        window.location.href = '/';
    });
}

function checkBan() {
    if (window.me?.isBanned === true) {
        Swal.fire({
            icon: 'error',
            title: 'You are banned!',
            text: 'A fiókod le van tiltva. Ha úgy gondolod, hogy tévedés történt, vedd fel a kapcsolatot az adminisztrátorral.',
            showCancelButton: false,
            confirmButtonText: 'OK',
        }).then((result) => {
            window.location.href = '/';
        });
    }
}