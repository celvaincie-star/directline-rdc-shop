"""Anti-spam : limite le nombre de messages traités par numéro de téléphone."""
import time
from collections import OrderedDict, defaultdict, deque


class LimiteurDebit:
    """Fenêtre glissante en mémoire : au plus `maximum` messages par `fenetre_s` secondes."""

    def __init__(self, maximum: int, fenetre_s: int) -> None:
        self.maximum = maximum
        self.fenetre_s = fenetre_s
        self._horodatages: dict[str, deque] = defaultdict(deque)
        self._deja_prevenus: set[str] = set()

    def autoriser(self, telephone: str) -> bool:
        maintenant = time.monotonic()
        file = self._horodatages[telephone]
        while file and maintenant - file[0] > self.fenetre_s:
            file.popleft()
        if len(file) >= self.maximum:
            return False
        file.append(maintenant)
        self._deja_prevenus.discard(telephone)
        return True

    def doit_prevenir(self, telephone: str) -> bool:
        """True une seule fois par blocage, pour prévenir le client sans le spammer à son tour."""
        if telephone in self._deja_prevenus:
            return False
        self._deja_prevenus.add(telephone)
        return True


class Dedoublonneur:
    """Meta peut renvoyer plusieurs fois le même message : on ne le traite qu'une fois."""

    def __init__(self, taille: int = 5000) -> None:
        self.taille = taille
        self._vus: OrderedDict[str, None] = OrderedDict()

    def deja_vu(self, message_id: str) -> bool:
        if message_id in self._vus:
            return True
        self._vus[message_id] = None
        if len(self._vus) > self.taille:
            self._vus.popitem(last=False)
        return False
