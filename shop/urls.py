from django.urls import path
from .views import *

urlpatterns = [

    path('', home, name='home'),

    path(
        'register/',
        register,
        name='register'
    ),

    path(
        'add-to-cart/<int:id>/',
        add_to_cart,
        name='add_to_cart'
    ),

    path(
        'cart/',
        cart,
        name='cart'
    ),

    path(
        'checkout/',
        checkout,
        name='checkout'
    ),
]
